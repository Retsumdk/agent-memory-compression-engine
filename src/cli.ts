import { MemoryStore } from "./store.js";
import { MemoryCompressionEngine, DEFAULT_ENGINE_OPTIONS, type EngineOptions } from "./engine.js";
import { AmcError, ValidationError } from "./types.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function invokedDirectly(moduleUrl: string): boolean {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  try {
    return realpathSync(arg1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
import { renderCycleReport, renderStats } from "./report.js";
import { runDemo } from "./demo.js";
import { startServer } from "./server.js";

export const VERSION = "1.0.0";

export const USAGE = `amce - agent memory compression engine

Usage:
  amce add <content...> [--pinned] [--weight <n>]
  amce compress
  amce status
  amce verify
  amce demo
  amce serve [--port <n>]

Commands:
  add        Add a memory entry (joins all content words)
  compress   Run one compression cycle and print the report
  status     Print store statistics and tier counts
  verify     Verify the hash chain of the store file
  demo       Print a deterministic end-to-end demo
  serve      Start the HTTP API (reads AMCE_TOKEN for writes)

Options:
  --store <path>   Store file path (default: ./.amce/memories.jsonl, env AMCE_STORE)
  --pinned         Mark an added memory as pinned (never compressed)
  --weight <n>     Explicit importance weight, 0..1
  --port <n>       TCP port for serve (default: 7600)
  -h, --help       Show this help
  -V, --version    Show version

Exit codes:
  0 ok   2 store corrupt   3 usage/validation   4 io error   5 server error`;

export const FLAG_ALIASES: Readonly<Record<string, string>> = {
  "-h": "--help",
  "-V": "--version",
  "-s": "--store",
  "-p": "--pinned",
  "-w": "--weight",
  "-P": "--port",
};

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const alias = FLAG_ALIASES[arg];
    const canonical = alias ?? arg;

    if (canonical === "--help" || canonical === "--version") {
      flags.set(canonical, true);
      continue;
    }
    if (canonical === "--pinned") {
      flags.set(canonical, true);
      continue;
    }
    if (canonical === "--store" || canonical === "--weight" || canonical === "--port") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new ValidationError(`${canonical} requires a value`);
      }
      flags.set(canonical, value);
      i++;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      throw new ValidationError(`unknown flag: ${arg}`);
    }
    if (command === undefined) {
      command = arg;
      continue;
    }
    positional.push(arg);
  }

  if (command === undefined && (flags.get("--help") || flags.get("--version"))) {
    command = "help";
  }
  if (command === undefined) {
    throw new ValidationError("missing command; run `amce --help`");
  }
  return { command, positional, flags };
}

export function resolveStorePath(flags: Map<string, string | boolean>): string {
  const envPath = process.env.AMCE_STORE;
  const flagPath = flags.get("--store");
  return typeof flagPath === "string" && flagPath !== "" ? flagPath : envPath ?? "./.amce/memories.jsonl";
}

function openEngine(flags: Map<string, string | boolean>): {
  engine: MemoryCompressionEngine;
  path: string;
} {
  const path = resolveStorePath(flags);
  const store = MemoryStore.load(path);
  return { engine: new MemoryCompressionEngine(store), path };
}

function parseNumber(flags: Map<string, string | boolean>, flag: string): number | undefined {
  const raw = flags.get(flag);
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw === "" || !/^-?\d+$/.test(raw)) {
    throw new ValidationError(`${flag} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ValidationError(`${flag} is out of range`);
  return value;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const { command, positional, flags } = parsed;

  if (flags.get("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (flags.get("--version")) {
    console.log(`amce ${VERSION}`);
    return 0;
  }

  switch (command) {
    case "help": {
      console.log(USAGE);
      return 0;
    }
    case "add": {
      if (positional.length === 0) {
        throw new ValidationError("add requires content: amce add <content...>");
      }
      const weightRaw = flags.get("--weight");
      let weight: number | undefined;
      if (weightRaw !== undefined) {
        if (typeof weightRaw !== "string") throw new ValidationError("--weight must be a number");
        const parsedWeight = Number(weightRaw);
        if (!Number.isFinite(parsedWeight)) throw new ValidationError("--weight must be a number");
        weight = parsedWeight;
      }
      const { engine, path } = openEngine(flags);
      const entry = engine.addMemory(positional.join(" "), {
        ...(flags.get("--pinned") === true ? { pinned: true } : {}),
        ...(weight !== undefined ? { weight } : {}),
      });
      console.log(`added ${entry.id} to ${path}`);
      return 0;
    }
    case "compress": {
      const { engine } = openEngine(flags);
      const result = engine.runCycle();
      if (result.summariesProduced === 0 && result.entriesBefore === 0) {
        console.log("Nothing to compress: the working set is empty.");
        return 0;
      }
      console.log(renderCycleReport(result, engine.tiers().counts, engine.stats().archivedOriginals));
      return 0;
    }
    case "status": {
      const { engine } = openEngine(flags);
      console.log(renderStats(engine.stats(), engine.tiers().counts));
      return 0;
    }
    case "verify": {
      const { path } = openEngine(flags);
      const result = MemoryStore.verify(path);
      if (result.ok) {
        console.log(`ok: ${result.records} records, hash chain intact (${path})`);
        return 0;
      }
      console.error(`CORRUPT: ${result.reason} (after ${result.records} valid records)`);
      return 2;
    }
    case "demo": {
      console.log(runDemo());
      return 0;
    }
    case "serve": {
      const port = parseNumber(flags, "--port") ?? 7600;
      const { engine } = openEngine(flags);
      const server = await startServer(engine, { port });
      console.log(`amce serve listening on port ${port}`);
      const shutdown = (): void => {
        server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return 0;
    }
    default:
      throw new ValidationError(`unknown command: ${String(command)}; run \`amce --help\``);
  }
}

export { DEFAULT_ENGINE_OPTIONS, type EngineOptions, AmcError, ValidationError };
