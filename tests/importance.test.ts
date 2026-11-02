import { describe, test, expect } from "bun:test";
import { importanceScore, tierOf, DEFAULT_IMPORTANCE } from "../src/importance.js";
import type { MemoryEntry } from "../src/types.js";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem_x",
    content: "some memory content",
    createdAt: "2026-01-01T00:00:00.000Z",
    accesses: 0,
    pinned: false,
    weight: 0,
    kind: "memory",
    ...overrides,
  };
}

const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("importance", () => {
  test("fresh entries score highest (recency = 1)", () => {
    const fresh = importanceScore(entry(), new Date("2026-01-01T00:00:00.000Z"), DEFAULT_IMPORTANCE);
    expect(fresh).toBeCloseTo(0.5);
  });

  test("recency decays by half-life: one half-life halves the recency term", () => {
    const score = importanceScore(entry(), new Date("2026-01-15T00:00:00.000Z"), DEFAULT_IMPORTANCE);
    expect(score).toBeCloseTo(0.25);
  });

  test("age cannot be negative even with a clock skew", () => {
    const score = importanceScore(entry(), new Date("2025-12-01T00:00:00.000Z"), DEFAULT_IMPORTANCE);
    expect(score).toBeCloseTo(0.5);
  });

  test("access frequency adds up to 0.2 asymptotically", () => {
    const none = importanceScore(entry(), NOW, DEFAULT_IMPORTANCE);
    const many = importanceScore(entry({ accesses: 1_000_000 }), NOW, DEFAULT_IMPORTANCE);
    expect(many - none).toBeCloseTo(0.2);
  });

  test("pinned entries add 0.15 and always tier hot", () => {
    const pinned = entry({ pinned: true, createdAt: "2020-01-01T00:00:00.000Z" });
    expect(importanceScore(pinned, NOW, DEFAULT_IMPORTANCE)).toBeCloseTo(0.15);
    expect(tierOf(pinned, NOW, DEFAULT_IMPORTANCE)).toBe("hot");
  });

  test("explicit weight adds up to 0.15 and out-of-range values are clamped", () => {
    const now = NOW.toISOString();
    const weighted = importanceScore(entry({ weight: 1, createdAt: now }), NOW, DEFAULT_IMPORTANCE);
    const clamped = importanceScore(entry({ weight: 99, createdAt: now }), NOW, DEFAULT_IMPORTANCE);
    expect(weighted).toBeCloseTo(0.65);
    expect(clamped).toBe(weighted);
  });

  test("tierOf: hot above threshold, summaries warm below it, memories cold-candidate", () => {
    const hot = entry({ createdAt: NOW.toISOString() });
    expect(tierOf(hot, NOW, { halfLifeDays: 14, hotThreshold: 0.4 })).toBe("hot");
    const coldSummary = entry({ kind: "summary", createdAt: "2020-01-01T00:00:00.000Z" });
    expect(tierOf(coldSummary, NOW, { halfLifeDays: 14, hotThreshold: 0.6 })).toBe("warm");
    const coldMemory = entry({ createdAt: "2020-01-01T00:00:00.000Z" });
    expect(tierOf(coldMemory, NOW, { halfLifeDays: 14, hotThreshold: 0.6 })).toBe("cold-candidate");
  });

  test("unparseable createdAt is treated as age 0, not NaN", () => {
    const score = importanceScore(entry({ createdAt: "not-a-date" }), NOW, DEFAULT_IMPORTANCE);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeCloseTo(0.5);
  });
});
