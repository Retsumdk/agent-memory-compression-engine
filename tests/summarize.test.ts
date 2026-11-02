import { describe, test, expect } from "bun:test";
import { splitSentences, summarizeCluster } from "../src/summarize.js";

const OPTS = { keepRatio: 0.4, maxSummarySentences: 5, minSentenceChars: 12 };

describe("summarize", () => {
  test("splitSentences breaks on sentence terminators", () => {
    expect(splitSentences("First sentence. Second one! Third? Done", 4)).toEqual([
      "First sentence.",
      "Second one!",
      "Third?",
      "Done",
    ]);
  });

  test("splitSentences drops fragments shorter than the minimum", () => {
    expect(splitSentences("Long enough sentence here. Ok?", 12)).toEqual([
      "Long enough sentence here.",
    ]);
  });

  test("splitSentences returns the whole content as one sentence when unsplit", () => {
    expect(splitSentences("no terminator at all", 4)).toEqual(["no terminator at all"]);
  });

  test("splitSentences of empty content is empty", () => {
    expect(splitSentences("   ", 4)).toEqual([]);
  });

  test("summary of a single sentence is that sentence", () => {
    expect(summarizeCluster(["Only one sentence here."], OPTS)).toBe("Only one sentence here.");
  });

  test("summary of empty cluster is empty string", () => {
    expect(summarizeCluster([], OPTS)).toBe("");
  });

  test("summary keeps the highest-scoring sentences in original order", () => {
    const contents = [
      "Database migration ran at 03:00 UTC without errors. The rollback plan is documented in the runbook.",
      "Database migration ran at 03:00 UTC without errors. Monitoring stayed green for six hours after.",
    ];
    const summary = summarizeCluster(contents, OPTS);
    // The repeated sentence scores highest; original order is preserved.
    expect(summary).toContain("Database migration ran at 03:00 UTC without errors.");
    const migrationIndex = summary.indexOf("Database migration ran");
    for (const later of summary.slice(migrationIndex + 1)) {
      expect(summary.indexOf(later)).toBeGreaterThanOrEqual(migrationIndex);
    }
  });

  test("summary is deterministic across runs", () => {
    const contents = [
      "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests.",
      "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished.",
    ];
    expect(summarizeCluster(contents, OPTS)).toBe(summarizeCluster(contents, OPTS));
  });

  test("maxSummarySentences caps the kept count", () => {
    const contents = [
      "Sentence one about databases. Sentence two about caches. Sentence three about queues. Sentence four about gates.",
      "Sentence five about rates. Sentence six about states. Sentence seven about weights. Sentence eight about dates.",
    ];
    const summary = summarizeCluster(contents, { ...OPTS, maxSummarySentences: 2 });
    const sentences = summary.split(/(?<=[.!?])\s+/);
    expect(sentences).toHaveLength(2);
  });
});
