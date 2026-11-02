# agent-memory-compression-engine

Deterministic agent-memory compression: redundancy clustering, extractive summaries, and a tiered append-only archive. Zero runtime dependencies.

## The problem

An agent's memory store grows without bound. The same facts get written down again and again — a deploy failure re-worded three sessions in a row, a user preference re-stated every morning, an exact duplicate saved twice because the writer crashed between write and check. Every repetition costs tokens on every future load, and none of the deduplication you need survives contact with reality:

- **Observability stacks** tell you memory is growing. They do nothing to shrink it.
- **LLM-based summarization** is nondeterministic, costs a model call per cycle, and can silently distort stored facts.
- **Hand-rolled dedup** (`content === other.content`) catches only exact duplicates and misses everything else.

What long-running agents actually need is a boring, deterministic compressor: find the entries that say the same thing, replace each redundant group with one faithful summary, and archive — never delete — the originals.

## The solution

`agent-memory-compression-engine` is a TypeScript library + CLI that runs **compression cycles** over a durable memory store:

1. **Cluster** live memories whose word-shingles overlap enough (Jaccard >= threshold), with a SimHash Hamming-distance shortcut for near-exact duplicates. Pinned memories are never clustered.
2. **Summarize** each redundant cluster with a deterministic extractive summary (top-scoring sentences by cluster term frequency, original order preserved, sources linked).
3. **Tier** the result: hot (pinned or high-scoring), warm (summaries), cold-candidate (low-scoring originals). Superseded originals are archived in the append-only store — nothing is ever deleted.
4. **Record** the cycle in a SHA-256 hash-chained JSONL store, so the store's integrity is verifiable at any time with `amce verify`.

Same inputs → same summaries → same summary ids. No model calls, no network, no randomness.

## How it works

```
memories (append-only JSONL, hash-chained)
   │
   ▼
working set (live entries replayed from the chain)
   │
   ├─ tokenize → word shingles (bigrams by default)
   ├─ simhash64 per entry (SHA-256-backed, stable)
   ├─ pairwise: hamming <= 2 (shortcut) OR jaccard >= 0.5 → union-find merge
   │
   ▼
clusters ── size >= 2 ──► extractive summary entry (warm tier)
        └─ size 1  ──► stays as-is (hot or cold-candidate by importance)
   │
   ▼
cycle record appended: summaries + superseded ids + metrics
```

**Importance scoring** (drives the tier assignment): `0.5·recency + 0.2·frequency + 0.15·pinned + 0.15·explicit`, where recency decays exponentially with a configurable half-life (default 14 days).

**Replay model:** a cycle record supersedes its source ids and inserts its summaries. Loading the store replays every record, so the working set after N cycles is fully derived from the chain. Summaries themselves can be superseded by later cycles (nested compression).

## Getting started

**Install from GitHub** (no registry package; git installs run `prepare`, which compiles TypeScript):

```bash
npm install github:Retsumdk/agent-memory-compression-engine
```

Bun blocks git-dependency lifecycle scripts by default — if you use Bun, trust the package after adding:

```bash
bun add github:Retsumdk/agent-memory-compression-engine
bun pm trust agent-memory-compression-engine
```

Or clone and run:

```bash
git clone https://github.com/Retsumdk/agent-memory-compression-engine.git
cd agent-memory-compression-engine
bun install
bun test
```

## CLI

```
amce - agent memory compression engine

Usage:
  amce add <content...> [--pinned] [--weight <n>]
  amce compress
  amce status
  amce verify
  amce demo
  amce serve [--port <n>]
```

A real walkthrough (store starts empty; the two CI sentences cluster — entry ids are content+time derived, so yours will differ):

```console
$ amce add "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests."
added mem_ba32b613a4c8d9e4 to ./.amce/memories.jsonl
$ amce add "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished."
added mem_daffa8dbdf6dec28 to ./.amce/memories.jsonl
$ amce add "Quarterly revenue report due to the finance team by February 10."
added mem_8320ead0d9ef23ab to ./.amce/memories.jsonl
$ amce add "ALWAYS confirm with the operator before deleting production data." --pinned --weight 1
added mem_8a0ecd8aa1d81b0a to ./.amce/memories.jsonl
$ amce compress
Compression cycle #1 at 2026-11-02T21:15:05.349Z
  Entries: 4 -> 3 (2 merged into 1 summaries)
  Tokens: 45 -> 32 (ratio 28.9%)
  Clusters: 1 merged, 1 untouched
  Tiers: hot=1 warm=1 coldCandidate=1
  Archived originals: 2
Summaries:
  [sum_901946c45b07f68f] <- 2 sources
    "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished."
$ amce status
Memory store status
  Store records: 5
  Memories added: 4
  Cycles completed: 1
  Archived originals: 2
  Live entries: 3
  Live tokens: 32
  Tiers: hot=1 warm=1 coldCandidate=1
$ amce verify
ok: 5 records, hash chain intact (./.amce/memories.jsonl)
```

Tampering is detected, with the exact location:

```console
$ # flip a byte in record 1 out-of-band, then:
$ amce verify --store ./.amce/memories.jsonl
CORRUPT: ./.amce/memories.jsonl:1: hash mismatch (chain broken) (after 0 valid records)
$ echo $?
2
```

Exit codes: `0` ok, `2` store corrupt, `3` usage/validation, `4` io error, `5` server error.

## HTTP API

`amce serve --port 7600` starts a zero-dependency HTTP server. Write endpoints require bearer auth; set `AMCE_TOKEN` or they answer `503` (disabled, not open).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness. |
| GET | `/stats` | none | Store stats + tier counts. |
| GET | `/memories` | none | Current working set. |
| GET | `/verify` | none | Hash-chain verification result. |
| POST | `/memories` | bearer | `{ "content": "...", "pinned?": bool, "weight?": 0..1 }` → 201 entry. |
| POST | `/cycle` | bearer | Run one compression cycle → 200 result. |

```console
$ AMCE_TOKEN=secret amce serve --port 7600 &
$ curl -s -X POST localhost:7600/memories \
    -H "Authorization: Bearer secret" -H "content-type: application/json" \
    -d '{"content": "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests."}'
{"entry":{"id":"mem_79410aff629a5b8b",...}}
$ curl -s localhost:7600/health
{"ok":true}
```

## Library use

```ts
import { MemoryStore, MemoryCompressionEngine } from "agent-memory-compression-engine";

const store = MemoryStore.load("./.amce/memories.jsonl");
const engine = new MemoryCompressionEngine(store);

engine.addMemory("Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests.");
engine.addMemory("Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished.");

const result = engine.runCycle();
console.log(result.summariesProduced); // 1
console.log(result.compressionRatio);  // 0.52 — two entries kept only one summary's tokens
console.log(result.summaries[0]!.text);
// "Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished."

const { counts } = engine.tiers();
console.log(counts); // { hot: 0, warm: 1, 'cold-candidate': 0 }
```

All engine knobs are optional and validated at construction: `similarityThreshold` (0,1], `shingleSize`, `exactDupHamming`, `minShinglesForHammingShortcut`, `keepRatio` (0,1], `maxSummarySentences`, `minSentenceChars`, `halfLifeDays`, `hotThreshold` (0,1]. A clock can be injected for fully deterministic runs.

## Demo

`amce demo` prints a deterministic end-to-end run (fixed clock, 12 scripted memories, one cycle) — byte-identical every time, enforced by test and CI:

```console
$ amce demo
agent-memory-compression-engine demo
== adding 12 memories (fixed clock, one per hour)
added mem_79410aff629a5b8b
...
added mem_8e0886ae2d2cb198 (pinned)
...
== compression cycle
Compression cycle #1 at 2026-01-01T12:00:00.000Z
  Entries: 12 -> 8 (7 merged into 3 summaries)
  Tokens: 131 -> 102 (ratio 22.1%)
  Clusters: 3 merged, 4 untouched
  Tiers: hot=1 warm=3 coldCandidate=4
  Archived originals: 7
Summaries:
  [sum_b87cdad6d71abcf1] <- 3 sources
    "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests. ..."
  [sum_1ceb9e2c7cffb459] <- 2 sources
    "User preference: dark mode enabled, concise answers in the dashboard."
  [sum_74108533dbbd98e5] <- 2 sources
    "Database migration ran at 03:00 UTC without errors."
...
```

## Scope

This is **lexical** redundancy compression: token shingles + Jaccard/SimHash. It deliberately does not use embeddings or an LLM, so paraphrases with no shared word shingles ("the deploy broke because tests were slow" vs "CI timed out") will not cluster — that is the cost of determinism and zero dependencies. It is also not a vector database, a memory *retrieval* engine, or a general-purpose text summarizer; it compresses stores, it does not rank queries.

## License

[MIT](LICENSE) — built by [Retsumdk](https://github.com/Retsumdk).
