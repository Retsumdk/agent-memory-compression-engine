import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { MemoryCompressionEngine } from "./engine.js";
import { AmcError, ValidationError } from "./types.js";
import type { CompressionResult } from "./types.js";

const BODY_LIMIT = 1_048_576;

export interface ServerOptions {
  port: number;
  token?: string | undefined;
}

interface JsonBody {
  content?: unknown;
  pinned?: unknown;
  weight?: unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined || !header.toLowerCase().startsWith("bearer ")) return undefined;
  return header.slice(7).trim();
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(provided, "utf-8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function createServer(engine: MemoryCompressionEngine, options?: Partial<ServerOptions>): Server {
  const token = options?.token ?? process.env.AMCE_TOKEN ?? undefined;

  return createHttpServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method ?? "GET"} ${url.pathname}`;

      if (route === "GET /health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (route === "GET /stats") {
        const stats = engine.stats();
        sendJson(res, 200, { ...stats, tiers: engine.tiers().counts });
        return;
      }
      if (route === "GET /memories") {
        sendJson(res, 200, { memories: engine.workingSet() });
        return;
      }
      if (route === "GET /verify") {
        sendJson(res, 200, engine.verify());
        return;
      }
      if (route === "POST /memories") {
        if (token === undefined) {
          sendJson(res, 503, { error: "write endpoints require AMCE_TOKEN to be set" });
          return;
        }
        if (!tokenMatches(token, bearerToken(req))) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        let raw: string;
        try {
          raw = await readBody(req);
        } catch (error) {
          sendJson(res, 413, { error: (error as Error).message });
          return;
        }
        let body: JsonBody;
        try {
          body = JSON.parse(raw) as JsonBody;
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        try {
          if (typeof body.content !== "string") {
            throw new ValidationError("content must be a string");
          }
          if (body.pinned !== undefined && typeof body.pinned !== "boolean") {
            throw new ValidationError("pinned must be a boolean");
          }
          if (body.weight !== undefined && typeof body.weight !== "number") {
            throw new ValidationError("weight must be a number");
          }
          const entry = engine.addMemory(body.content, {
            ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
            ...(body.weight !== undefined ? { weight: body.weight } : {}),
          });
          sendJson(res, 201, { entry });
        } catch (error) {
          if (error instanceof AmcError) {
            sendJson(res, error.exitCode === 3 ? 400 : 500, { error: error.message });
          } else {
            sendJson(res, 500, { error: (error as Error).message });
          }
        }
        return;
      }
      if (route === "POST /cycle") {
        if (token === undefined) {
          sendJson(res, 503, { error: "write endpoints require AMCE_TOKEN to be set" });
          return;
        }
        if (!tokenMatches(token, bearerToken(req))) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        try {
          const result: CompressionResult = engine.runCycle();
          sendJson(res, 200, { result });
        } catch (error) {
          sendJson(res, 500, { error: (error as Error).message });
        }
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch((error: unknown) => {
      sendJson(res, 500, { error: (error as Error).message ?? "internal error" });
    });
  });
}

export async function startServer(
  engine: MemoryCompressionEngine,
  options?: Partial<ServerOptions>,
): Promise<Server> {
  const port = options?.port ?? 7600;
  const server = createServer(engine, options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  return server;
}
