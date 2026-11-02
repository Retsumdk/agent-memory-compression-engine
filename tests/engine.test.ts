import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/store.js";
import { MemoryCompressionEngine } from "../src/engine.js";
import { ValidationError } from "../src/types.js";

const BASE_MS = Date.parse("2026-01-01T00:00:00.000Z");

interface Fixture {
  engine: MemoryCompressionEngine;
  cleanup: () => void;
}

function makeEngine(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "amce-engine-"));
  const store = MemoryStore.load(join(dir, "memories.jsonl"));
  let tick = 0;
  const engine = new MemoryCompressionEngine(store, undefined, () => new Date(BASE_MS + (tick++) * 3_600_000));
  return {
    engine,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const CI_A = "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests.";
const CI_B = "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished.";
const REVENUE = "Quarterly revenue report due to the finance team by February 10.";
const PIN_RULE = "ALWAYS confirm with the operator before deleting production data.";

describe("engine", () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeEngine();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test("redundant memories merge into one summary in the working set", () => {
    const { engine } = fixture;
    engine.addMemory(CI_A);
    engine.addMemory(CI_B);
    engine.addMemory(REVENUE);

    const result = engine.runCycle();
    expect(result.entriesBefore).toBe(3);
    expect(result.clustersFormed).toBe(1);
    expect(result.entriesMerged).toBe(2);
    expect(result.summariesProduced).toBe(1);
    expect(result.untouchedClusters).toBe(1);
    expect(result.summaries[0]!.sourceIds).toHaveLength(2);
    expect(result.compressionRatio).toBeGreaterThan(0);

    const live = engine.workingSet();
    expect(live).toHaveLength(2);
    expect(live.filter((e) => e.kind === "summary")).toHaveLength(1);
    expect(live.filter((e) => e.kind === "memory").map((e) => e.content)).toEqual([REVENUE]);
  });

  test("pinned memories are never clustered or superseded", () => {
    const { engine } = fixture;
    engine.addMemory(CI_A);
    engine.addMemory(CI_B, { pinned: true });

    const result = engine.runCycle();
    expect(result.summariesProduced).toBe(0);
    expect(engine.workingSet()).toHaveLength(2);
  });

  test("an empty working set yields a zeroed no-op cycle", () => {
    const { engine } = fixture;
    const result = engine.runCycle();
    expect(result.entriesBefore).toBe(0);
    expect(result.summariesProduced).toBe(0);
    expect(result.compressionRatio).toBe(0);
    expect(engine.stats().cyclesCompleted).toBe(0);
  });

  test("cycle numbers increment and summaries link back to sources", () => {
    const { engine } = fixture;
    engine.addMemory(CI_A);
    engine.addMemory(CI_B);
    const first = engine.runCycle();
    expect(first.cycle).toBe(1);

    engine.addMemory("Fresh memory about deployment alerting thresholds.");
    const second = engine.runCycle();
    expect(second.cycle).toBe(2);
    expect(second.summariesProduced).toBe(0);
  });

  test("two engines replaying the same inputs produce identical summary ids", () => {
    const first = makeEngine();
    const second = makeEngine();
    try {
      for (const content of [CI_A, CI_B]) {
        first.engine.addMemory(content);
        second.engine.addMemory(content);
      }
      const a = first.engine.runCycle();
      const b = second.engine.runCycle();
      expect(a.summaries.map((s) => s.id)).toEqual(b.summaries.map((s) => s.id));
      expect(a.summaries.map((s) => s.text)).toEqual(b.summaries.map((s) => s.text));
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  test("empty content is rejected", () => {
    const { engine } = fixture;
    expect(() => engine.addMemory("   ")).toThrow(ValidationError);
  });

  test("weight outside [0, 1] is rejected", () => {
    const { engine } = fixture;
    expect(() => engine.addMemory("content", { weight: 1.5 })).toThrow(ValidationError);
  });

  test("invalid createdAt is rejected", () => {
    const { engine } = fixture;
    expect(() => engine.addMemory("content", { createdAt: "not-a-date" })).toThrow(ValidationError);
  });

  test("verify reports chain integrity after appends", () => {
    const { engine } = fixture;
    engine.addMemory(CI_A);
    engine.addMemory(CI_B);
    engine.runCycle();
    const verified = engine.verify();
    expect(verified.ok).toBe(true);
    expect(verified.records).toBe(3);
  });

  test("tier counts separate hot, warm, and cold-candidate entries", () => {
    const { engine } = fixture;
    engine.addMemory(PIN_RULE, { pinned: true, weight: 1 });
    engine.addMemory(CI_A);
    engine.addMemory(CI_B);
    engine.addMemory(REVENUE);
    engine.runCycle();
    const { counts } = engine.tiers();
    expect(counts.hot).toBe(1);
    expect(counts.warm).toBe(1);
    expect(counts["cold-candidate"]).toBe(1);
  });
});
