import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { MemoryCompressionEngine } from "./engine.js";
import { renderCycleReport, renderStats } from "./report.js";

const BASE_MS = Date.parse("2026-01-01T00:00:00.000Z");

const DEMO_MEMORIES: Array<{ content: string; pinned?: boolean; weight?: number }> = [
  { content: "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests." },
  { content: "Deploy failed: CI pipeline timeout after 10 minutes on the integration test suite." },
  { content: "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished." },
  { content: "User preference: dark mode enabled, concise answers." },
  { content: "User preference: dark mode enabled, concise answers in the dashboard." },
  { content: "User wants dark mode on the dashboard and short replies." },
  { content: "Database migration ran at 03:00 UTC without errors." },
  { content: "Database migration ran at 03:00 UTC without errors." },
  { content: "ALWAYS confirm with the operator before deleting production data.", pinned: true, weight: 1 },
  { content: "Q1 revenue report is due to the finance team by February 10." },
  { content: "The slack circuit breaker should open after 5 consecutive delivery failures within one minute." },
  { content: "Operator timezone is America/New_York; schedule jobs after 09:00 local time." },
];

export function runDemo(): string {
  const dir = mkdtempSync(join(tmpdir(), "amce-demo-"));
  try {
    const storePath = join(dir, "memories.jsonl");
    const store = MemoryStore.load(storePath);
    let tick = 0;
    const clock = (): Date => new Date(BASE_MS + tick * 3_600_000);
    const engine = new MemoryCompressionEngine(store, undefined, clock);

    const lines: string[] = [];
    lines.push("agent-memory-compression-engine demo");
    lines.push("== adding 12 memories (fixed clock, one per hour)");
    for (const demo of DEMO_MEMORIES) {
      const entry = engine.addMemory(demo.content, {
        ...(demo.pinned !== undefined ? { pinned: demo.pinned } : {}),
        ...(demo.weight !== undefined ? { weight: demo.weight } : {}),
      });
      lines.push(`added ${entry.id}${demo.pinned === true ? " (pinned)" : ""}`);
    }
    tick = 12;
    lines.push("== compression cycle");
    const result = engine.runCycle();
    lines.push(renderCycleReport(result, engine.tiers().counts, engine.stats().archivedOriginals));
    lines.push("== status");
    lines.push(renderStats(engine.stats(), engine.tiers().counts));
    return lines.join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
