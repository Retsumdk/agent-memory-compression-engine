import { describe, test, expect } from "bun:test";
import { tokenize, contentWords, shingles, jaccard, termFrequency, countTokens, STOPWORDS } from "../src/tokens.js";
import { simhash64, hammingDistance, hash64 } from "../src/simhash.js";

describe("tokens", () => {
  test("tokenize lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("Deploy FAILED: CI-pipeline timeout!")).toEqual([
      "deploy", "failed", "ci", "pipeline", "timeout",
    ]);
  });

  test("tokenize of punctuation-only text is empty", () => {
    expect(tokenize("!!! ... ???")).toEqual([]);
  });

  test("contentWords removes stopwords", () => {
    expect(contentWords(tokenize("The deploy failed because of the timeout"))).toEqual([
      "deploy", "failed", "timeout",
    ]);
  });

  test("STOPWORDS covers common function words", () => {
    for (const word of ["the", "and", "of", "to", "is", "it"]) {
      expect(STOPWORDS.has(word)).toBe(true);
    }
  });

  test("shingles builds n-grams and handles short inputs", () => {
    expect(shingles(["a", "b", "c"], 2)).toEqual(["a b", "b c"]);
    expect(shingles(["only"], 2)).toEqual(["only"]);
    expect(shingles([], 2)).toEqual([]);
  });

  test("shingle size below 1 throws", () => {
    expect(() => shingles(["a"], 0)).toThrow(RangeError);
  });

  test("jaccard: identical sets are 1, disjoint are 0, empty-vs-empty is 0", () => {
    const a = new Set(["x", "y"]);
    expect(jaccard(a, new Set(["x", "y"]))).toBe(1);
    expect(jaccard(a, new Set(["p", "q"]))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  test("jaccard computes the expected overlap ratio", () => {
    expect(jaccard(new Set(["a", "b", "c", "d"]), new Set(["c", "d", "e"]))).toBeCloseTo(2 / 5);
  });

  test("termFrequency counts occurrences", () => {
    const tf = termFrequency(["a", "b", "a"]);
    expect(tf.get("a")).toBe(2);
    expect(tf.get("b")).toBe(1);
  });

  test("countTokens matches tokenize length", () => {
    expect(countTokens("one two three")).toBe(3);
  });
});

describe("simhash", () => {
  test("identical texts produce identical fingerprints", () => {
    const shingleList = shingles(tokenize("deploy failed because CI timed out"), 2);
    expect(simhash64(shingleList)).toBe(simhash64([...shingleList]));
  });

  test("hamming distance of identical fingerprints is 0", () => {
    const h = simhash64(["a b", "b c"]);
    expect(hammingDistance(h, h)).toBe(0);
  });

  test("similar texts sit closer than dissimilar ones", () => {
    const base = shingles(tokenize("deploy failed because CI timed out waiting for tests"), 2);
    const similar = shingles(tokenize("deploy failed because CI timed out waiting for integration tests"), 2);
    const other = shingles(tokenize("user prefers concise answers and dark mode always enabled"), 2);
    const dNear = hammingDistance(simhash64(base), simhash64(similar));
    const dFar = hammingDistance(simhash64(base), simhash64(other));
    expect(dNear).toBeLessThan(dFar);
  });

  test("empty shingle list fingerprints to a stable value", () => {
    expect(simhash64([])).toBe(simhash64([]));
  });

  test("hash64 is a stable 64-bit fingerprint of the text", () => {
    expect(hash64("abc")).toBe(hash64("abc"));
    expect(hash64("abc")).not.toBe(hash64("abd"));
    expect(hash64("abc") >= 0n).toBe(true);
  });
});
