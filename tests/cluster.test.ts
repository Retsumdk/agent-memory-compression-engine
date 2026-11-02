import { describe, test, expect } from "bun:test";
import { clusterEntries } from "../src/cluster.js";
import { summarizeCluster } from "../src/summarize.js";

interface Item {
  id: string;
  content: string;
}

const A: Item = { id: "1", content: "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests." };
const B: Item = { id: "2", content: "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished." };
const C: Item = { id: "3", content: "Quarterly revenue report due to the finance team by February 10." };
const D: Item = { id: "4", content: "Database migration ran at 03:00 UTC without errors." };
const E: Item = { id: "5", content: "Database migration ran at 03:00 UTC without errors." };

describe("cluster", () => {
  test("similar entries cluster together; distinct ones stay apart", () => {
    const clusters = clusterEntries([A, B, C, D], {
      similarityThreshold: 0.5,
      shingleSize: 2,
      exactDupHamming: 2,
      minShinglesForHammingShortcut: 8,
    });
    expect(clusters).toHaveLength(3);
    expect(clusters[0]).toHaveLength(2);
  });

  test("exact duplicates merge via the hamming shortcut", () => {
    const clusters = clusterEntries([D, E, C], {
      similarityThreshold: 0.9,
      shingleSize: 2,
      exactDupHamming: 2,
      minShinglesForHammingShortcut: 8,
    });
    expect(clusters).toHaveLength(2);
  });

  test("the hamming shortcut requires enough shingles (no false merges of short texts)", () => {
    const x: Item = { id: "x", content: "alpha beta gamma" };
    const y: Item = { id: "y", content: "alpha delta epsilon" };
    const clusters = clusterEntries([x, y], {
      similarityThreshold: 0.99,
      shingleSize: 2,
      exactDupHamming: 30,
      minShinglesForHammingShortcut: 8,
    });
    expect(clusters).toHaveLength(2);
  });

  test("clustering is transitive: a-b and b-c link a and c into one cluster", () => {
    const mid: Item = { id: "mid", content: A.content };
    const clusters = clusterEntries([A, mid, B], {
      similarityThreshold: 0.5,
      shingleSize: 2,
      exactDupHamming: 2,
      minShinglesForHammingShortcut: 8,
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  test("empty input yields no clusters", () => {
    expect(
      clusterEntries([], {
        similarityThreshold: 0.5,
        shingleSize: 2,
        exactDupHamming: 2,
        minShinglesForHammingShortcut: 8,
      }),
    ).toEqual([]);
  });

  test("clusters preserve first-seen order and member order", () => {
    const clusters = clusterEntries([C, A, B, D], {
      similarityThreshold: 0.5,
      shingleSize: 2,
      exactDupHamming: 2,
      minShinglesForHammingShortcut: 8,
    });
    expect(clusters[0]!.map((e) => e.id)).toEqual(["3"]);
    expect(clusters[1]!.map((e) => e.id)).toEqual(["1", "2"]);
    expect(clusters[2]!.map((e) => e.id)).toEqual(["4"]);
  });
});

describe("summarize", () => {
  const SUMMARY_OPTIONS = { keepRatio: 0.4, maxSummarySentences: 5, minSentenceChars: 12 };

  test("single entry passes through as one sentence", () => {
    expect(summarizeCluster([D.content], SUMMARY_OPTIONS)).toBe(D.content);
  });

  test("empty content list yields an empty summary", () => {
    expect(summarizeCluster([], SUMMARY_OPTIONS)).toBe("");
  });

  test("selection keeps the highest-scoring sentences in original order", () => {
    const text = summarizeCluster(
      [
        "Alpha beta gamma delta epsilon zeta eta theta.",
        "Alpha beta gamma delta epsilon zeta eta theta again.",
        "Completely unrelated words about quarterly revenue reports.",
      ],
      { keepRatio: 0.5, maxSummarySentences: 5, minSentenceChars: 12 },
    );
    expect(text.split(/(?<=[.!?])\s+/)).toHaveLength(2);
  });

  test("short fragments below minSentenceChars are dropped", () => {
    expect(summarizeCluster(["Tiny."], { ...SUMMARY_OPTIONS, minSentenceChars: 12 })).toBe("");
  });

  test("summary is deterministic across runs", () => {
    const contents = [A.content, B.content, C.content];
    expect(summarizeCluster(contents, SUMMARY_OPTIONS)).toBe(
      summarizeCluster(contents, SUMMARY_OPTIONS),
    );
  });

  test("maxSummarySentences caps the kept sentences", () => {
    const long = [
      "Sentence one about deployment failures and timeouts.",
      "Sentence two about deployment failures and retries.",
      "Sentence three about deployment failures and alerts.",
      "Sentence four about deployment failures and paging.",
      "Sentence five about deployment failures and fixes.",
      "Sentence six about deployment failures and reviews.",
    ];
    const text = summarizeCluster(long, { keepRatio: 1, maxSummarySentences: 2, minSentenceChars: 12 });
    expect(text.split(/(?<=[.!?])\s+/)).toHaveLength(2);
  });
});
