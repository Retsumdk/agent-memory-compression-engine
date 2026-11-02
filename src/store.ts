import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  StoreCorruptError,
  StoreIoError,
  ValidationError,
} from "./types.js";
import type {
  AppendBody,
  EntryKind,
  MemoryEntry,
  StoreRecord,
  StoredCycle,
  VerifyResult,
} from "./types.js";

const GENESIS_HASH = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && ISO_PREFIX.test(value);
}

function asInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function canonicalBody(record: StoreRecord): string {
  if (record.type === "memory_added") {
    return JSON.stringify({
      seq: record.seq,
      ts: record.ts,
      type: record.type,
      entry: record.entry,
      prevHash: record.prevHash,
    });
  }
  return JSON.stringify({
    seq: record.seq,
    ts: record.ts,
    type: record.type,
    result: record.result,
    prevHash: record.prevHash,
  });
}

function recordHash(prevHash: string, body: string): string {
  return createHash("sha256").update(prevHash + body).digest("hex");
}

function assertEntry(
  value: unknown,
  file: string,
  line: number,
  expectKind: "memory" | "summary",
): MemoryEntry {
  const where = `${file}:${line}`;
  if (typeof value !== "object" || value === null) {
    throw new StoreCorruptError(`${where}: entry is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  const content = raw.content;
  const createdAt = raw.createdAt;
  const accesses = asInt(raw.accesses);
  const pinned = raw.pinned;
  const weight = raw.weight;
  const kind = raw.kind;
  if (typeof id !== "string" || id.length === 0) {
    throw new StoreCorruptError(`${where}: entry.id must be a non-empty string`);
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new StoreCorruptError(`${where}: entry.content must be a non-empty string`);
  }
  if (!isIso(createdAt) || Number.isNaN(new Date(createdAt).getTime())) {
    throw new StoreCorruptError(`${where}: entry.createdAt must be an ISO timestamp`);
  }
  if (accesses === undefined || accesses < 0) {
    throw new StoreCorruptError(`${where}: entry.accesses must be a non-negative integer`);
  }
  if (typeof pinned !== "boolean") {
    throw new StoreCorruptError(`${where}: entry.pinned must be a boolean`);
  }
  if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0 || weight > 1) {
    throw new StoreCorruptError(`${where}: entry.weight must be a number in [0, 1]`);
  }
  if (typeof kind !== "string" || kind !== expectKind) {
    throw new StoreCorruptError(`${where}: entry.kind must be "${expectKind}"`);
  }
  const entry: MemoryEntry = {
    id,
    content,
    createdAt,
    accesses,
    pinned,
    weight,
    kind: kind as EntryKind,
  };
  if (kind === "summary") {
    const sourceIds = raw.sourceIds;
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      !sourceIds.every((s) => typeof s === "string" && s.length > 0)
    ) {
      throw new StoreCorruptError(
        `${where}: summary entries require a non-empty sourceIds string array`,
      );
    }
    entry.sourceIds = sourceIds;
  }
  return entry;
}

function assertMetrics(value: unknown, file: string, line: number) {
  const where = `${file}:${line}`;
  if (typeof value !== "object" || value === null) {
    throw new StoreCorruptError(`${where}: metrics is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const numericFields = [
    "entriesBefore",
    "clustersFormed",
    "entriesMerged",
    "summariesProduced",
    "tokensBefore",
    "tokensAfter",
    "untouchedClusters",
  ] as const;
  for (const field of numericFields) {
    const v = raw[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new StoreCorruptError(`${where}: metrics.${field} must be a non-negative integer`);
    }
  }
  const ratio = raw.compressionRatio;
  if (typeof ratio !== "number" || Number.isNaN(ratio) || ratio < 0 || ratio > 1) {
    throw new StoreCorruptError(`${where}: metrics.compressionRatio must be in [0, 1]`);
  }
  return {
    entriesBefore: raw.entriesBefore as number,
    clustersFormed: raw.clustersFormed as number,
    entriesMerged: raw.entriesMerged as number,
    summariesProduced: raw.summariesProduced as number,
    tokensBefore: raw.tokensBefore as number,
    tokensAfter: raw.tokensAfter as number,
    compressionRatio: ratio,
    untouchedClusters: raw.untouchedClusters as number,
  };
}

function assertRecord(value: unknown, file: string, line: number): StoreRecord {
  const where = `${file}:${line}`;
  if (typeof value !== "object" || value === null) {
    throw new StoreCorruptError(`${where}: record is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const seq = asInt(raw.seq);
  if (seq === undefined || seq < 1) {
    throw new StoreCorruptError(`${where}: seq must be a positive integer`);
  }
  if (!isIso(raw.ts) || Number.isNaN(new Date(raw.ts as string).getTime())) {
    throw new StoreCorruptError(`${where}: ts must be an ISO timestamp`);
  }
  const ts = raw.ts as string;
  if (!isHex64(raw.prevHash) || !isHex64(raw.hash)) {
    throw new StoreCorruptError(`${where}: prevHash and hash must be 64-char hex strings`);
  }
  const prevHash = raw.prevHash as string;
  const hash = raw.hash as string;
  if (raw.type === "memory_added") {
    const entry = assertEntry(raw.entry, file, line, "memory");
    const record = { seq, ts, type: "memory_added" as const, entry, prevHash, hash };
    verifyHash(record, file, line);
    return record;
  }
  if (raw.type === "cycle_completed") {
    const result = raw.result;
    if (typeof result !== "object" || result === null) {
      throw new StoreCorruptError(`${where}: result is not an object`);
    }
    const rawResult = result as Record<string, unknown>;
    const cycle = asInt(rawResult.cycle);
    if (cycle === undefined || cycle < 1) {
      throw new StoreCorruptError(`${where}: result.cycle must be a positive integer`);
    }
    const at = rawResult.at;
    if (!isIso(at) || Number.isNaN(new Date(at as string).getTime())) {
      throw new StoreCorruptError(`${where}: result.at must be an ISO timestamp`);
    }
    if (!Array.isArray(rawResult.summaries)) {
      throw new StoreCorruptError(`${where}: result.summaries must be an array`);
    }
    const summaries = (rawResult.summaries as unknown[]).map((s) =>
      assertEntry(s, file, line, "summary"),
    );
    if (!Array.isArray(rawResult.superseded)) {
      throw new StoreCorruptError(`${where}: result.superseded must be an array`);
    }
    const superseded = rawResult.superseded as unknown[];
    if (!superseded.every((s) => typeof s === "string" && s.length > 0)) {
      throw new StoreCorruptError(`${where}: result.superseded must contain non-empty strings`);
    }
    const metrics = assertMetrics(rawResult.metrics, file, line);
    const stored: StoredCycle = {
      cycle,
      at: at as string,
      summaries,
      superseded: superseded as string[],
      metrics,
    };
    const record = {
      seq,
      ts,
      type: "cycle_completed" as const,
      result: stored,
      prevHash,
      hash,
    };
    verifyHash(record, file, line);
    return record;
  }
  throw new StoreCorruptError(`${where}: unknown record type`);
}

function verifyHash(record: StoreRecord, file: string, line: number): void {
  const expected = recordHash(record.prevHash, canonicalBody(record));
  if (expected !== record.hash) {
    throw new StoreCorruptError(`${file}:${line}: hash mismatch (chain broken)`);
  }
}

export function verifyStore(path: string): VerifyResult {
  return MemoryStore.verify(path);
}

export class MemoryStore {
  private records: StoreRecord[] = [];
  private readonly ids = new Set<string>();

  private constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  static load(path: string): MemoryStore {
    const store = new MemoryStore(path);
    if (!existsSync(path)) return store;
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (error) {
      throw new StoreIoError(`cannot read ${path}: ${(error as Error).message}`);
    }
    const lines = text.split("\n");
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.trim() === "") continue;
      const lineNo = i + 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new StoreCorruptError(`${path}:${lineNo}: invalid JSON`);
      }
      const record = assertRecord(parsed, path, lineNo);
      if (record.prevHash !== prevHash) {
        throw new StoreCorruptError(`${path}:${lineNo}: chain mismatch (prevHash does not link)`);
      }
      store.records.push(record);
      if (record.type === "memory_added") store.ids.add(record.entry.id);
      if (record.type === "cycle_completed") {
        for (const summary of record.result.summaries) store.ids.add(summary.id);
      }
      prevHash = record.hash;
    }
    return store;
  }

  static verify(path: string): VerifyResult {
    if (!existsSync(path)) return { ok: true, records: 0 };
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (error) {
      return { ok: false, records: 0, reason: `io: ${(error as Error).message}` };
    }
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      try {
        const record = assertRecord(JSON.parse(lines[i] as string), path, lineNo);
        if (record.prevHash !== prevHash) {
          return { ok: false, records: i, badSeq: record.seq, reason: "chain mismatch" };
        }
        prevHash = record.hash;
      } catch (error) {
        return {
          ok: false,
          records: i,
          badSeq: i + 1,
          reason: (error as Error).message,
        };
      }
    }
    return { ok: true, records: lines.length };
  }

  get nextSeq(): number {
    return this.records.length + 1;
  }

  get recordCount(): number {
    return this.records.length;
  }

  rawRecords(): StoreRecord[] {
    return [...this.records];
  }

  append(body: AppendBody): StoreRecord {
    const seq = this.nextSeq;
    const prevHash =
      this.records.length === 0
        ? GENESIS_HASH
        : (this.records[this.records.length - 1] as StoreRecord).hash;
    const base = { ...body, seq, prevHash } as StoreRecord;
    const hash = recordHash(prevHash, canonicalBody(base));
    const record = { ...base, hash } as StoreRecord;
    if (record.type === "memory_added") {
      if (this.ids.has(record.entry.id)) {
        throw new ValidationError(`duplicate entry id: ${record.entry.id}`);
      }
    } else {
      for (const summary of record.result.summaries) {
        if (this.ids.has(summary.id)) {
          throw new ValidationError(`duplicate entry id: ${summary.id}`);
        }
        if (
          summary.kind !== "summary" ||
          !Array.isArray(summary.sourceIds) ||
          summary.sourceIds.length === 0
        ) {
          throw new ValidationError(
            `summary entry ${summary.id} must carry a non-empty sourceIds array`,
          );
        }
      }
    }
    const dir = dirname(this.filePath);
    try {
      if (dir !== "" && dir !== "." && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(this.filePath, JSON.stringify(record) + "\n");
    } catch (error) {
      throw new StoreIoError(`cannot append to ${this.filePath}: ${(error as Error).message}`);
    }
    this.records.push(record);
    if (record.type === "memory_added") {
      this.ids.add(record.entry.id);
    } else {
      for (const summary of record.result.summaries) this.ids.add(summary.id);
    }
    return record;
  }

  liveState(): Map<string, MemoryEntry> {
    const state = new Map<string, MemoryEntry>();
    for (const record of this.records) {
      if (record.type === "memory_added") {
        state.set(record.entry.id, record.entry);
      } else {
        for (const id of record.result.superseded) state.delete(id);
        for (const summary of record.result.summaries) state.set(summary.id, summary);
      }
    }
    return state;
  }

  cycleCount(): number {
    let cycles = 0;
    for (const record of this.records) {
      if (record.type === "cycle_completed") cycles++;
    }
    return cycles;
  }

  archivedCount(): number {
    let superseded = 0;
    for (const record of this.records) {
      if (record.type === "cycle_completed") superseded += record.result.superseded.length;
    }
    return superseded;
  }
}
