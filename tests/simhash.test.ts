import { describe, test, expect } from "bun:test";
import { hash64, hammingDistance, simhash64 } from "../src/simhash.js";
import { shingles, tokenize } from "../src/tokens.js";

describe("simhash", () => {
  test("identical inputs produce identical 64-bit hashes", () => {
    const a = simhash64(shingles(tokenize("the CI pipeline timed out"), 2));
    const b = simhash64(shingles(tokenize("the CI pipeline timed out"), 2));
    expect(a).toBe(b);
    expect(hammingDistance(a, b)).toBe(0);
  });

  test("hash is stable across runs (sha256-backed, not randomized)", () => {
    const first = hash64("deterministic");
    const second = hash64("deterministic");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0n);
    expect(first).toBeLessThan(1n << 64n);
  });

  test("similar texts have small hamming distance, dissimilar have large", () => {
    const base = tokenize("deploy failed because the CI pipeline timed out waiting for integration tests");
    const minorEdit = tokenize("deploy failed because the CI pipeline timed out waiting for integration test");
    const unrelated = tokenize("quarterly revenue report due february tenth to the finance team");
    const a = simhash64(shingles(base, 2));
    const near = simhash64(shingles(minorEdit, 2));
    const far = simhash64(shingles(unrelated, 2));
    expect(hammingDistance(a, near)).toBeLessThanOrEqual(8);
    expect(hammingDistance(a, far)).toBeGreaterThan(8);
  });

  test("simhash of no shingles is well-defined and consistent", () => {
    expect(simhash64([])).toBe(simhash64([]));
  });

  test("hammingDistance counts differing bits", () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0b1010n, 0b0101n)).toBe(4);
    expect(hammingDistance(0n, 1n << 63n)).toBe(1);
  });
});
