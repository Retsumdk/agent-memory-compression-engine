export type Tier = "hot" | "warm" | "cold-candidate";

export type EntryKind = "memory" | "summary";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
  accesses: number;
  pinned: boolean;
  weight: number;
  kind: EntryKind;
  sourceIds?: string[];
}

export interface SummaryInfo {
  id: string;
  sourceIds: string[];
  text: string;
}

export interface CycleMetrics {
  entriesBefore: number;
  clustersFormed: number;
  entriesMerged: number;
  summariesProduced: number;
  tokensBefore: number;
  tokensAfter: number;
  compressionRatio: number;
  untouchedClusters: number;
}

export interface CompressionResult extends CycleMetrics {
  cycle: number;
  at: string;
  summaries: SummaryInfo[];
  superseded: string[];
}

export interface StoredCycle {
  cycle: number;
  at: string;
  summaries: MemoryEntry[];
  superseded: string[];
  metrics: CycleMetrics;
}

export type StoreRecord =
  | {
      seq: number;
      ts: string;
      type: "memory_added";
      entry: MemoryEntry;
      prevHash: string;
      hash: string;
    }
  | {
      seq: number;
      ts: string;
      type: "cycle_completed";
      result: StoredCycle;
      prevHash: string;
      hash: string;
    };

export type AppendBody =
  | { ts: string; type: "memory_added"; entry: MemoryEntry }
  | { ts: string; type: "cycle_completed"; result: StoredCycle };

export type VerifyResult =
  | { ok: true; records: number }
  | { ok: false; records: number; badSeq?: number; reason: string };

export class AmcError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number = 1) {
    super(message);
    this.name = "AmcError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class ValidationError extends AmcError {
  constructor(message: string) {
    super("VALIDATION", message, 3);
    this.name = "ValidationError";
  }
}

export class StoreCorruptError extends AmcError {
  constructor(message: string) {
    super("STORE_CORRUPT", message, 2);
    this.name = "StoreCorruptError";
  }
}

export class StoreIoError extends AmcError {
  constructor(message: string) {
    super("STORE_IO", message, 4);
    this.name = "StoreIoError";
  }
}
