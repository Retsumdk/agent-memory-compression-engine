import { describe, test, expect } from "bun:test";
import { runDemo } from "../src/demo.js";
import { DEMO_OUTPUT } from "../src/demo-output.js";

describe("demo", () => {
  test("demo output matches the enforced constant byte-for-byte", () => {
    expect(runDemo()).toBe(DEMO_OUTPUT);
  });

  test("demo constant exercises all sections", () => {
    expect(DEMO_OUTPUT).toContain("== adding 12 memories");
    expect(DEMO_OUTPUT).toContain("== compression cycle");
    expect(DEMO_OUTPUT).toContain("Compression cycle #1");
    expect(DEMO_OUTPUT).toContain("== status");
    expect(DEMO_OUTPUT).toContain("sum_");
  });
});
