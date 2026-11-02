import type { MemoryEntry } from "./types.js";

export interface ImportanceOptions {
  halfLifeDays: number;
  hotThreshold: number;
}

export const DEFAULT_IMPORTANCE: ImportanceOptions = {
  halfLifeDays: 14,
  hotThreshold: 0.6,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function importanceScore(
  entry: MemoryEntry,
  now: Date,
  options: ImportanceOptions,
): number {
  const created = new Date(entry.createdAt).getTime();
  const ageDays = Number.isNaN(created)
    ? 0
    : Math.max(0, (now.getTime() - created) / 86_400_000);
  const recency = Math.pow(2, -ageDays / options.halfLifeDays);
  const frequency = entry.accesses / (entry.accesses + 5);
  const pinned = entry.pinned ? 1 : 0;
  const explicit = clamp01(entry.weight);
  return 0.5 * recency + 0.2 * frequency + 0.15 * pinned + 0.15 * explicit;
}

export function tierOf(
  entry: MemoryEntry,
  now: Date,
  options: ImportanceOptions,
): "hot" | "warm" | "cold-candidate" {
  if (entry.pinned) return "hot";
  const score = importanceScore(entry, now, options);
  if (score >= options.hotThreshold) return "hot";
  return entry.kind === "summary" ? "warm" : "cold-candidate";
}
