import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/store.js";
import { MemoryCompressionEngine } from "../src/engine.js";
import { startServer, type Server } from "../src/server.js";

describe("server", () => {
  let server: Server | undefined;
  let dir: string | undefined;

  function makeEngine(): MemoryCompressionEngine {
    dir = mkdtempSync(join(tmpdir(), "amce-server-test-"));
    const store = MemoryStore.load(join(dir, "memories.jsonl"));
    return new MemoryCompressionEngine(store);
  }

  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = undefined;
    dir = undefined;
  });

  async function start(engine: MemoryCompressionEngine, token?: string): Promise<number> {
    server = await startServer(engine, { port: 0, ...(token !== undefined ? { token } : {}) });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return address.port;
  }

  test("GET /health is open", async () => {
    const port = await start(makeEngine());
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("GET /stats and /memories are open reads", async () => {
    const engine = makeEngine();
    engine.addMemory("Database migration ran at 03:00 UTC without errors.");
    const port = await start(engine);
    const stats = await (await fetch(`http://127.0.0.1:${port}/stats`)).json();
    expect(stats.records).toBe(1);
    expect(stats.liveEntries).toBe(1);
    const memories = await (await fetch(`http://127.0.0.1:${port}/memories`)).json();
    expect(memories.memories).toHaveLength(1);
  });

  test("POST /memories is 503 without AMCE_TOKEN", async () => {
    const port = await start(makeEngine());
    const res = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(503);
  });

  test("POST /memories rejects bad tokens and adds with the right one", async () => {
    const port = await start(makeEngine(), "secret-token");
    const bad = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(bad.status).toBe(401);

    const good = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" },
      body: JSON.stringify({ content: "Quarterly revenue report due February 10." }),
    });
    expect(good.status).toBe(201);
    const body = (await good.json()) as { entry: { id: string } };
    expect(body.entry.id.startsWith("mem_")).toBe(true);
  });

  test("POST /memories validates the body", async () => {
    const port = await start(makeEngine(), "t");
    const invalid = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ content: 42 }),
    });
    expect(invalid.status).toBe(400);
    const badJson = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: "not json",
    });
    expect(badJson.status).toBe(400);
  });

  test("POST /cycle runs a compression cycle with auth", async () => {
    const engine = makeEngine();
    engine.addMemory("Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests.");
    engine.addMemory("Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished.");
    const port = await start(engine, "t");
    const res = await fetch(`http://127.0.0.1:${port}/cycle`, {
      method: "POST",
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { summariesProduced: number } };
    expect(body.result.summariesProduced).toBe(1);
  });

  test("GET /verify reports chain integrity", async () => {
    const port = await start(makeEngine());
    const res = await fetch(`http://127.0.0.1:${port}/verify`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, records: 0 });
  });

  test("unknown routes are 404", async () => {
    const port = await start(makeEngine());
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });
});
