import type { CompressionResult, TierCounts } from "./engine.js";

function percent(ratio: number): string {
  return (ratio * 100).toFixed(1);
}

export function renderCycleReport(
  result: CompressionResult,
  tierCounts: TierCounts,
  archivedOriginals: number,
): string {
  const lines: string[] = [];
  lines.push(`Compression cycle #${result.cycle} at ${result.at}`);
  lines.push(
    `  Entries: ${result.entriesBefore} -> ${result.entriesBefore - result.entriesMerged + result.summariesProduced}` +
      ` (${result.entriesMerged} merged into ${result.summariesProduced} summaries)`,
  );
  lines.push(
    `  Tokens: ${result.tokensBefore} -> ${result.tokensAfter}` +
      ` (ratio ${percent(result.compressionRatio)}%)`,
  );
  lines.push(
    `  Clusters: ${result.clustersFormed} merged, ${result.untouchedClusters} untouched`,
  );
  lines.push(
    `  Tiers: hot=${tierCounts.hot} warm=${tierCounts.warm}` +
      ` coldCandidate=${tierCounts["cold-candidate"]}`,
  );
  lines.push(`  Archived originals: ${archivedOriginals}`);
  if (result.summaries.length > 0) {
    lines.push("Summaries:");
    for (const summary of result.summaries) {
      lines.push(`  [${summary.id}] <- ${summary.sourceIds.length} sources`);
      lines.push(`    "${summary.text}"`);
    }
  }
  return lines.join("\n");
}

export function renderStats(stats: {
  records: number;
  memoriesAdded: number;
  cyclesCompleted: number;
  archivedOriginals: number;
  liveEntries: number;
  liveTokens: number;
}, tierCounts: TierCounts): string {
  const lines: string[] = [];
  lines.push("Memory store status");
  lines.push(`  Store records: ${stats.records}`);
  lines.push(`  Memories added: ${stats.memoriesAdded}`);
  lines.push(`  Cycles completed: ${stats.cyclesCompleted}`);
  lines.push(`  Archived originals: ${stats.archivedOriginals}`);
  lines.push(`  Live entries: ${stats.liveEntries}`);
  lines.push(`  Live tokens: ${stats.liveTokens}`);
  lines.push(
    `  Tiers: hot=${tierCounts.hot} warm=${tierCounts.warm}` +
      ` coldCandidate=${tierCounts["cold-candidate"]}`,
  );
  return lines.join("\n");
}
