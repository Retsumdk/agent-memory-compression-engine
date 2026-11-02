import { describe, test, expect } from "bun:test";
import { parseArgs, FLAG_ALIASES, USAGE, resolveStorePath } from "../src/cli.js";
import { ValidationError } from "../src/types.js";

describe("cli", () => {
  test("every flag documented in USAGE has an alias entry or canonical mapping", () => {
    const documented = [...USAGE.matchAll(/(^|\s)(--[a-z-]+|-V|-h)(?=\s|$)/g)].map(
      (m) => m[2] as string,
    );
    const known = new Set(Object.keys(FLAG_ALIASES).concat(Object.values(FLAG_ALIASES)));
    for (const flag of documented) {
      expect(known.has(flag)).toBe(true);
    }
    expect(documented).not.toHaveLength(0);
  });

  test("aliases resolve to canonical flags", () => {
    expect(FLAG_ALIASES["-s"]).toBe("--store");
    expect(FLAG_ALIASES["-p"]).toBe("--pinned");
    expect(FLAG_ALIASES["-w"]).toBe("--weight");
    expect(FLAG_ALIASES["-h"]).toBe("--help");
    expect(FLAG_ALIASES["-V"]).toBe("--version");
  });

  test("parses flags before the command (leading global flags)", () => {
    const parsed = parseArgs(["--store", "/tmp/x.jsonl", "add", "hello", "world"]);
    expect(parsed.command).toBe("add");
    expect(parsed.flags.get("--store")).toBe("/tmp/x.jsonl");
    expect(parsed.positional).toEqual(["hello", "world"]);
  });

  test("parses flags after the command as well", () => {
    const parsed = parseArgs(["add", "hello", "--pinned", "-w", "0.8"]);
    expect(parsed.command).toBe("add");
    expect(parsed.flags.get("--pinned")).toBe(true);
    expect(parsed.flags.get("--weight")).toBe("0.8");
  });

  test("bare -h maps to help, not a command", () => {
    const parsed = parseArgs(["-h"]);
    expect(parsed.command).toBe("help");
    expect(parsed.flags.get("--help")).toBe(true);
  });

  test("unknown flags throw ValidationError", () => {
    expect(() => parseArgs(["add", "x", "--bogus"])).toThrow(ValidationError);
    expect(() => parseArgs(["add", "x", "-Z"])).toThrow(ValidationError);
  });

  test("flags that require a value fail when missing", () => {
    expect(() => parseArgs(["add", "x", "--store"])).toThrow(ValidationError);
  });

  test("missing command throws with guidance", () => {
    expect(() => parseArgs([])).toThrow("missing command");
  });

  test("resolveStorePath precedence: flag > env > default", () => {
    const saved = process.env.AMCE_STORE;
    try {
      process.env.AMCE_STORE = "/env/path.jsonl";
      expect(resolveStorePath(new Map())).toBe("/env/path.jsonl");
      expect(resolveStorePath(new Map([["--store", "/flag/path.jsonl"]]))).toBe("/flag/path.jsonl");
      delete process.env.AMCE_STORE;
      expect(resolveStorePath(new Map())).toBe("./.amce/memories.jsonl");
    } finally {
      if (saved === undefined) delete process.env.AMCE_STORE;
      else process.env.AMCE_STORE = saved;
    }
  });
});
