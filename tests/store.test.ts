import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/store.js";
import { StoreCorruptError } from "../src/types.js";
import type { MemoryEntry } from "../src/types.js";

function makeEntry(id: string, content: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    accesses: 0,
    pinned: false,
    weight: 0,
    kind: "memory",
    ...overrides,
  };
}

describe("store", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "amce-store-"));
    path = join(dir, "memories.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("append writes hash-linked records and load restores them", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "first memory") });
    store.append({ ts: "2026-01-01T01:00:00.000Z", type: "memory_added", entry: makeEntry("b", "second memory") });

    const reloaded = MemoryStore.load(path);
    expect(reloaded.recordCount).toBe(2);
    expect(reloaded.liveState().get("a")?.content).toBe("first memory");
  });

  test("the chain links: each record prevHash equals the previous record hash", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "one") });
    store.append({ ts: "2026-01-01T01:00:00.000Z", type: "memory_added", entry: makeEntry("b", "two") });
    const records = store.rawRecords();
    expect(records[0]!.prevHash).toBe("0".repeat(64));
    expect(records[1]!.prevHash).toBe(records[0]!.hash);
  });

  test("round-trip stability: reload recomputes identical hashes", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "stable content") });
    const before = store.rawRecords()[0]!.hash;

    const reloaded = MemoryStore.load(path);
    expect(reloaded.rawRecords()[0]!.hash).toBe(before);
  });

  test("duplicate ids are rejected", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "one") });
    expect(() =>
      store.append({ ts: "2026-01-01T01:00:00.000Z", type: "memory_added", entry: makeEntry("a", "two") }),
    ).toThrow(/duplicate entry id/);
  });

  test("tampering with a payload breaks verification at the right record", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "honest content") });
    store.append({ ts: "2026-01-01T01:00:00.000Z", type: "memory_added", entry: makeEntry("b", "second record") });

    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    const tampered = JSON.parse(lines[0]!) as Record<string, unknown>;
    const entry = tampered.entry as Record<string, unknown>;
    entry.content = "forged content";
    lines[0] = JSON.stringify(tampered);
    writeFileSync(path, lines.join("\n") + "\n");

    const result = MemoryStore.verify(path);
    expect(result.ok).toBe(false);
    expect(result.badSeq).toBe(1);
  });

  test("truncating the chain breaks the link at the forged record", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "one") });
    store.append({ ts: "2026-01-01T01:00:00.000Z", type: "memory_added", entry: makeEntry("b", "two") });

    const lines = readFileSync(path, "utf-8").trimEnd().split("\n");
    const forged = JSON.parse(lines[1]!) as Record<string, unknown>;
    forged.prevHash = "f".repeat(64);
    lines[1] = JSON.stringify(forged);
    writeFileSync(path, lines.join("\n") + "\n");

    const result = MemoryStore.verify(path);
    expect(result.ok).toBe(false);
    expect(result.badSeq).toBe(2);
  });

  test("verify on a missing file reports zero records and ok", () => {
    const result = MemoryStore.verify(join(dir, "missing.jsonl"));
    expect(result).toEqual({ ok: true, records: 0 });
  });

  test("invalid JSON raises StoreCorruptError with file:line", () => {
    writeFileSync(path, "{not json}\n");
    expect(() => MemoryStore.load(path)).toThrow(StoreCorruptError);
    try {
      MemoryStore.load(path);
    } catch (error) {
      expect((error as StoreCorruptError).message).toContain("memories.jsonl:1");
      expect((error as StoreCorruptError).exitCode).toBe(2);
    }
  });

  test("unknown record types are rejected", () => {
    const bogus = { seq: 1, ts: "2026-01-01T00:00:00.000Z", type: "hijack", prevHash: "0".repeat(64), hash: "0".repeat(64) };
    writeFileSync(path, JSON.stringify(bogus) + "\n");
    expect(() => MemoryStore.load(path)).toThrow(/unknown record type/);
  });

  test("cycle records replay: superseded entries leave the live state", () => {
    const store = MemoryStore.load(path);
    store.append({ ts: "2026-01-01T00:00:00.000Z", type: "memory_added", entry: makeEntry("a", "one") });
    store.append({
      ts: "2026-01-01T01:00:00.000Z",
      type: "cycle_completed",
      result: {
        cycle: 1,
        at: "2026-01-01T01:00:00.000Z",
        summaries: [makeEntry("s1", "summary text", { kind: "summary", sourceIds: ["a"] })],
        superseded: ["a"],
        metrics: {
          entriesBefore: 1,
          clustersFormed: 1,
          entriesMerged: 1,
          summariesProduced: 1,
          tokensBefore: 2,
          tokensAfter: 2,
          compressionRatio: 0,
          untouchedClusters: 0,
        },
      },
    });
    const state = store.liveState();
    expect(state.has("a")).toBe(false);
    expect(state.get("s1")?.kind).toBe("summary");
    expect(store.archivedCount()).toBe(1);
    expect(store.cycleCount()).toBe(1);
  });

  test("nested summary entries must carry sourceIds", () => {
    const store = MemoryStore.load(path);
    const bad = makeEntry("s1", "summary", { kind: "summary" });
    delete (bad as Partial<MemoryEntry>).sourceIds;
    expect(() =>
      store.append({ ts: "2026-01-01T00:00:00.000Z", type: "cycle_completed", result: { cycle: 1, at: "2026-01-01T00:00:00.000Z", summaries: [bad], superseded: [], metrics: { entriesBefore: 0, clustersFormed: 0, entriesMerged: 0, summariesProduced: 1, tokensBefore: 0, tokensAfter: 1, compressionRatio: 0, untouchedClusters: 0 } } }),
    ).toThrow(/sourceIds/);
  });
});
