---
date: 2026-04-13
topic: second-mind-improvements
focus: wiki-plugin as Claude Code CLI second mind
---

# Ideation: wiki-plugin Second Mind Improvements

## Codebase Context

Node.js Claude Code plugin v1.8.0. 12 MCP tools, 3 hooks (SessionStart, Stop, UserPromptSubmit), 3 skills. SiYuan Docker backend. Key pain points: manual build→bump→push dance, no fetch timeout, static mining categories, no retrieval feedback loop, crosslink is O(all blocks).

## Ranked Ideas

### 1. Retrieval Feedback Tracking
**Description:** Record `custom-last-useful` timestamp on wiki pages when Claude uses them. Wire via PostToolUse hook on `wiki_get`.
**Rationale:** Keystone for the compounding flywheel. Enables decay scoring, confidence weighting, quality-gated ingestion. Without it everything else is guesswork.
**Downsides:** Requires PostToolUse hook + sidecar tracking; minor overhead per wiki_get call.
**Confidence:** 88%
**Complexity:** Medium
**Status:** Unexplored

### 2. Mine Tool-Call Sequences
**Description:** Extend `mine-helpers.js` to scan `tool_use` JSONL entries (currently skipped). Extract recurring patterns as procedural workflow candidates.
**Rationale:** Tacit "how things are done" knowledge is invisible to current miner. Declarative gotchas captured; workflows are not.
**Downsides:** Output harder to structure; needs new category type + ingest format.
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

### 3. Fetch Timeout / Circuit Breaker
**Description:** Add `AbortController` with ~5s timeout to every `siyuan-client.js` `post()` call.
**Rationale:** Every session end freezes 30s when SiYuan Docker is stopped. Most impactful daily UX fix.
**Downsides:** None significant.
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 4. GitHub Actions CI + Single-Source Version
**Description:** GHA on `v*` tag: build bundle, update both version files, commit back, create release. Developer only needs `git tag + push`.
**Rationale:** Most fragile step in workflow, documented as footgun. Eliminates 3 manual post-merge steps.
**Downsides:** GHA commits back to main — needs branch protection awareness.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 5. Learned Mining Categories
**Description:** When snippets are manually confirmed but didn't match any regex, store key phrases as candidate patterns in per-project `custom-categories.json`.
**Rationale:** 4 static categories miss all domain vocabulary. Miner learns project dialect over time without code changes.
**Downsides:** Pattern accumulation needs pruning; noisy ingests could pollute signal.
**Confidence:** 78%
**Complexity:** Medium
**Status:** Unexplored

### 6. `wiki_context_for_path` — Pre-Edit Proactive Injection
**Description:** New MCP tool + PreToolUse hook: takes file paths, returns relevant gotchas/ADRs/stale warnings before edits begin.
**Rationale:** Inverts pull model. Surfaces knowledge you didn't know to search for. Highest-value knowledge is the gotcha you forgot to check.
**Downsides:** Adds latency to file edits; needs tight relevance filtering.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 7. Incremental Crosslink
**Description:** Replace `LIMIT 100000` full-notebook scan with targeted pass: only newly ingested block + pages mentioning new aliases.
**Rationale:** Currently O(all blocks), called every session end. Grows linearly. Infrastructure fix before it becomes painful.
**Downsides:** Misses cross-links between existing pages — needs occasional full scan.
**Confidence:** 87%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | `wiki_ping` health check | Covered by fetch timeout fix |
| 2 | lintStale absolute path | Narrow edge case, low daily impact |
| 3 | journalAppend N+1 query | Premature optimization at current scale |
| 4 | Lazy cross-referencing (read-time) | Breaks SiYuan native graph view |
| 5 | Contradiction check at write time | Adds latency to every write; batch audit better |
| 6 | Continuous JSONL background watcher | Introduces daemon dependency; premature |
| 7 | Ops log sharding | Won't hit scale issues for years |
| 8 | SiYuan backend abstraction | Massive refactor, speculative payoff |
| 9 | Branch-switch mid-session mining | Adds git exec to every UserPromptSubmit |
| 10 | Archive decay | Requires retrieval feedback tracking first |
| 11 | Knowledge expiry on source deletion | Extends existing lintStale; not novel enough |
| 12 | Fingerprint dedup for manual writes | Marginal value |
| 13 | Skills drift fix | Low leverage; easy manual update |

## Session Log
- 2026-04-13: Initial ideation — ~37 raw candidates, 7 survived adversarial filter
