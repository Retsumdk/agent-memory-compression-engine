export const DEMO_OUTPUT = `agent-memory-compression-engine demo
== adding 12 memories (fixed clock, one per hour)
added mem_79410aff629a5b8b
added mem_089e04d525747095
added mem_654d6fe4a0683c17
added mem_2aa1410dc1a34bd5
added mem_52a8512b6c497f83
added mem_56fda7438d1b952d
added mem_7ce8cfa0adcc9925
added mem_dac8c5c9d63d5960
added mem_8e0886ae2d2cb198 (pinned)
added mem_ae6f98622df4b161
added mem_008a9e08393b14f0
added mem_8956cf2c63e7b6ca
== compression cycle
Compression cycle #1 at 2026-01-01T12:00:00.000Z
  Entries: 12 -> 8 (7 merged into 3 summaries)
  Tokens: 131 -> 102 (ratio 22.1%)
  Clusters: 3 merged, 4 untouched
  Tiers: hot=1 warm=3 coldCandidate=4
  Archived originals: 7
Summaries:
  [sum_b87cdad6d71abcf1] <- 3 sources
    "Deploy failed: CI pipeline timeout after 10 minutes waiting on the integration tests. Deploy failed: CI pipeline timeout after 10 minutes, integration tests never finished."
  [sum_1ceb9e2c7cffb459] <- 2 sources
    "User preference: dark mode enabled, concise answers in the dashboard."
  [sum_74108533dbbd98e5] <- 2 sources
    "Database migration ran at 03:00 UTC without errors."
== status
Memory store status
  Store records: 13
  Memories added: 12
  Cycles completed: 1
  Archived originals: 7
  Live entries: 8
  Live tokens: 102
  Tiers: hot=1 warm=3 coldCandidate=4`;
