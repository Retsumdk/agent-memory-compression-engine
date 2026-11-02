import { createHash } from "node:crypto";
import { MemoryStore } from "./store.js";
import { clusterEntries } from "./cluster.js";
import { summarizeCluster } from "./summarize.js";
import { DEFAULT_IMPORTANCE, importanceScore, tierOf } from "./importance.js";
import { countTokens } from "./tokens.js";
import { ValidationError } from "./types.js";
import type {
  CompressionResult,
  CycleMetrics,
  MemoryEntry,
  StoreRecord,
  Tier,
  VerifyResult,
} from "./types.js";
export type { CompressionResult, CycleMetrics, MemoryEntry, SummaryInfo, Tier } from "./types.js";

export interface EngineOptions {
  similarityThreshold: number;
  shingleSize: number;
  exactDupHamming: number;
  minShinglesForHammingShortcut: number;
  keepRatio: number;
  maxSummarySentences: number;
  minSentenceChars: number;
  halfLifeDays: number;
  hotThreshold: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  similarityThreshold: 0.5,
  shingleSize: 2,
  exactDupHamming: 2,
  minShinglesForHammingShortcut: 8,
  keepRatio: 0.4,
  maxSummarySentences: 5,
  minSentenceChars: 12,
  ...DEFAULT_IMPORTANCE,
};

export interface AddOptions {
  pinned?: boolean;
  weight?: number;
  accesses?: number;
  id?: string;
  createdAt?: string;
}

export interface TierCounts {
  hot: number;
  warm: number;
  "cold-candidate": number;
}

function newId(prefix: string, seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  return `${prefix}_${digest.slice(0, 16)}`;
}

export class MemoryCompressionEngine {
  private readonly options: EngineOptions;
  private readonly clock: () => Date;

  constructor(
    private readonly store: MemoryStore,
    options?: Partial<EngineOptions>,
    clock: () => Date = () => new Date(),
  ) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options };
    this.clock = clock;
    const o = this.options;
    if (o.similarityThreshold <= 0 || o.similarityThreshold > 1) {
      throw new ValidationError("similarityThreshold must be in (0, 1]");
    }
    if (o.shingleSize < 1) throw new ValidationError("shingleSize must be >= 1");
    if (o.exactDupHamming < 0) throw new ValidationError("exactDupHamming must be >= 0");
    if (o.keepRatio <= 0 || o.keepRatio > 1) {
      throw new ValidationError("keepRatio must be in (0, 1]");
    }
    if (o.maxSummarySentences < 1) throw new ValidationError("maxSummarySentences must be >= 1");
    if (o.minSentenceChars < 1) throw new ValidationError("minSentenceChars must be >= 1");
    if (o.halfLifeDays <= 0) throw new ValidationError("halfLifeDays must be > 0");
    if (o.hotThreshold <= 0 || o.hotThreshold > 1) {
      throw new ValidationError("hotThreshold must be in (0, 1]");
    }
  }

  addMemory(content: string, options?: AddOptions): MemoryEntry {
    if (typeof content !== "string" || content.trim() === "") {
      throw new ValidationError("content must be a non-empty string");
    }
    const now = this.clock();
    if (options?.weight !== undefined) {
      const weight = options.weight;
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new ValidationError("weight must be a number in [0, 1]");
      }
    }
    if (options?.accesses !== undefined) {
      const accesses = options.accesses;
      if (!Number.isInteger(accesses) || accesses < 0) {
        throw new ValidationError("accesses must be a non-negative integer");
      }
    }
    if (options?.createdAt !== undefined) {
      const created = new Date(options.createdAt).getTime();
      if (Number.isNaN(created)) {
        throw new ValidationError("createdAt must be a valid ISO timestamp");
      }
    }
    const entry: MemoryEntry = {
      id: options?.id ?? newId("mem", `${content}\u0000${now.toISOString()}\u0000${this.store.nextSeq}`),
      content,
      createdAt: options?.createdAt ?? now.toISOString(),
      accesses: options?.accesses ?? 0,
      pinned: options?.pinned ?? false,
      weight: options?.weight ?? 0,
      kind: "memory",
    };
    this.store.append({ ts: now.toISOString(), type: "memory_added", entry });
    return entry;
  }

  private allRecords(): StoreRecord[] {
    return this.store.rawRecords();
  }

  verify(): VerifyResult {
    return MemoryStore.verify(this.store.path);
  }

  workingSet(): MemoryEntry[] {
    return [...this.store.liveState().values()];
  }

  tiers(): { counts: TierCounts; entries: Array<{ entry: MemoryEntry; tier: Tier; importance: number }> } {
    const now = this.clock();
    const entries = this.workingSet().map((entry) => {
      const score = importanceScore(entry, now, this.options);
      return { entry, tier: tierOf(entry, now, this.options), importance: score };
    });
    const counts: TierCounts = { hot: 0, warm: 0, "cold-candidate": 0 };
    for (const item of entries) counts[item.tier]++;
    return { counts, entries };
  }

  runCycle(): CompressionResult {
    const now = this.clock();
    const live = this.workingSet();
    const tokensBefore = live.reduce((acc, e) => acc + countTokens(e.content), 0);
    const compressible = live.filter((e) => !e.pinned);
    const clusters = clusterEntries(compressible, {
      similarityThreshold: this.options.similarityThreshold,
      shingleSize: this.options.shingleSize,
      exactDupHamming: this.options.exactDupHamming,
      minShinglesForHammingShortcut: this.options.minShinglesForHammingShortcut,
    });
    const multi = clusters.filter((c) => c.length >= 2);
    const cycle = this.store.cycleCount() + 1;
    const summaries: MemoryEntry[] = [];
    const superseded: string[] = [];
    for (const cluster of multi) {
      const sourceIds = cluster.map((e) => e.id);
      const text = summarizeCluster(
        cluster.map((e) => e.content),
        {
          keepRatio: this.options.keepRatio,
          maxSummarySentences: this.options.maxSummarySentences,
          minSentenceChars: this.options.minSentenceChars,
        },
      );
      const entry: MemoryEntry = {
        id: newId("sum", `${sourceIds.join("|")}#${cycle}`),
        content: text,
        createdAt: now.toISOString(),
        accesses: Math.max(...cluster.map((e) => e.accesses)),
        pinned: false,
        weight: Math.max(...cluster.map((e) => e.weight)),
        kind: "summary",
        sourceIds,
      };
      summaries.push(entry);
      superseded.push(...sourceIds);
    }
    const supersededSet = new Set(superseded);
    const tokensAfter =
      live
        .filter((e) => !supersededSet.has(e.id))
        .reduce((acc, e) => acc + countTokens(e.content), 0) +
      summaries.reduce((acc, s) => acc + countTokens(s.content), 0);
    const metrics: CycleMetrics = {
      entriesBefore: live.length,
      clustersFormed: multi.length,
      entriesMerged: superseded.length,
      summariesProduced: summaries.length,
      tokensBefore,
      tokensAfter,
      compressionRatio: tokensBefore === 0 ? 0 : 1 - tokensAfter / tokensBefore,
      untouchedClusters: clusters.length - multi.length,
    };
    const result: CompressionResult = {
      cycle,
      at: now.toISOString(),
      summaries: summaries.map((s) => ({
        id: s.id,
        sourceIds: s.sourceIds ?? [],
        text: s.content,
      })),
      superseded,
      ...metrics,
    };
    if (summaries.length > 0) {
      this.store.append({
        ts: now.toISOString(),
        type: "cycle_completed",
        result: {
          cycle,
          at: now.toISOString(),
          summaries,
          superseded,
          metrics,
        },
      });
    }
    return result;
  }

  stats(): {
    records: number;
    memoriesAdded: number;
    cyclesCompleted: number;
    archivedOriginals: number;
    liveEntries: number;
    liveTokens: number;
  } {
    const records = this.allRecords();
    let memoriesAdded = 0;
    for (const record of records) {
      if (record.type === "memory_added") memoriesAdded++;
    }
    const live = this.workingSet();
    return {
      records: records.length,
      memoriesAdded,
      cyclesCompleted: this.store.cycleCount(),
      archivedOriginals: this.store.archivedCount(),
      liveEntries: live.length,
      liveTokens: live.reduce((acc, e) => acc + countTokens(e.content), 0),
    };
  }
}
