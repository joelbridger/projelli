# Keepance Test Robot

A persistent, deterministic harness that drives the **real Keepance desktop app**
on the Legion Windows bench over the WebView2 CDP protocol. It replaces the pile of
one-shot `scripts/demo/legion-*.mjs` scripts (one fresh SSH round-trip per click)
with ONE resident process that holds a live connection and exposes high-level verbs,
each returning a machine-readable **proof packet** plus an evidence bundle.

Why it exists: the report at `docs/quality/2026-06-24-testing-strategy-evaluation-and-plan.md`.

## Quick start

```bash
# 1. Tunnel: server :9444 -> bench 127.0.0.1:9223 (IPv4 on BOTH ends — NOT localhost)
ssh -fN -o ExitOnForwardFailure=yes -L 127.0.0.1:9444:127.0.0.1:9223 james@100.127.67.22

# 2a. One-shot end-to-end proof (no daemon needed):
npm run robot:smoke           # reset -> open -> sweep -> ask -> isolation, all must pass

# 2b. Or run the daemon and fire verbs at it:
npm run robot:daemon          # holds the live connection on http://127.0.0.1:7331
node scripts/robot/cli.mjs sweep
node scripts/robot/cli.mjs reset '{"mode":"fast"}'
node scripts/robot/cli.mjs ask '{"question":"What is the total portfolio value for this household?"}'
node scripts/robot/cli.mjs isolation

# Without a daemon, any verb can run directly:
node scripts/robot/cli.mjs sweep --no-daemon
```

## Verbs

| Verb | What it does | `ok` means |
|---|---|---|
| `reset` | `{mode:'fast'}` (default) purges residue + reseeds + reloads, KEEPS the index. `{mode:'full'}` kills the app, deletes the `.keepance` index, restarts, reseeds (leaves the index DELETED). `{mode:'snapshot'}` kills the app and RESTORES the frozen, fully-indexed workspace from its archive (no re-import / no re-embed), then restarts + reseeds — the fast path to a clean world that can immediately Ask. | advisor profession + 26 matters seeded (snapshot: restore also succeeded) |
| `open` | Opens the Northcrest recent workspace from the launcher and dismisses the first-run feature tour. No-op if already open. | main UI (spine nav) mounted |
| `sweep` | Clicks every top-level surface (settings, privacy, audit, workflows, email, files), screenshots each. | every surface reachable |
| `ask` | Self-navigates into a client's Ask, asks a question, waits for the answer to settle, reports citation chips / attestation / "not cited" warning. With `{deterministic:true}` the answer is replayed from a recorded fixture and an egress guard asserts nothing reached a live model. | settled AND a NEW cited attestation + chip (AND, if deterministic, no live-AI egress + the fixture was used) |
| `isolation` | Calls the Rust `rag_retrieve` directly per matter scope; counts cross-client leaks. | **every leak-check case has leak === 0** |

## Proof packet

Every verb returns:

```json
{ "verb": "sweep", "ok": true, "data": { ... }, "error": null,
  "startedAt": "ISO", "durationMs": 1234, "artifacts": ["...png/.dom.txt/.console.log/..."] }
```

Evidence bundles land in `scripts/robot/_artifacts/<timestamp>-<verb>/` (git-ignored):
screenshot, DOM text, console log, network log, and the verb's data JSON.

## Architecture

- `connection.mjs` — one memoized Playwright `connectOverCDP` session; `getPage`/`reconnect`/`disconnect`. **`disconnect` only detaches — it never closes the app.** Uses `127.0.0.1` (Node `fetch` resolves `localhost` to `::1`, but the tunnel binds IPv4).
- `proof.mjs` — `runVerb(name, fn)` wraps a verb into a timed proof packet.
- `fixtures/aiReplay.mjs` — deterministic AI replay (generalized from `scripts/marketing-capture/lib/mock-ai.ts`): a local SSE proxy + `page.route()` interception that replays a recorded fixture. Works cross-machine because interception runs in this Node process, not the browser.
- `artifacts.mjs` — console/network listeners + evidence-bundle writer.
- `bench.mjs` — SSH/scp/tunnel + app kill/restart/index-delete/port-wait + the **snapshot** primitives (archive/restore/status + the fail-safe guard). The bench-side tar/extract/atomic-swap lives in `bench/snapshot.ps1`.
- `fixtures/aiReplay.mjs` — deterministic AI replay: a local SSE proxy + `page.route()` interception that replays a recorded fixture. Emits **OpenAI** (`choices[].delta.content` + `data:[DONE]`) or **Anthropic** (`content_block_delta`) frames per the fixture's `wireFormat` (default Anthropic). Returns a controller whose `served` count proves the fixture was actually used.
- `fixtures/egressGuard.mjs` — the deterministic-mode tripwire: routes every live-AI host/path to a recorder+abort, so a deterministic run that leaks to a real provider (or never uses the fixture) FAILS instead of silently spending money / going flaky.
- `verbs/*.mjs` — one file per verb (ported from the matching `legion-*.mjs`).
- `build-snapshot.mjs` — one-time job that freezes a fully-indexed workspace into the golden archive.
- `record-ask-fixture.mjs` — records the provider-accurate OpenAI Ask fixture from one live run.
- `server.mjs` — the resident daemon (serializes verbs; reconnect-and-retry on a dropped page).
- `cli.mjs` — thin client (daemon by default, `--no-daemon` to run inline).
- `smoke.mjs` — the end-to-end proof (`npm run robot:smoke`).

## Frozen workspace snapshot — stop rebuilding the world every run

Re-importing + re-embedding hundreds of files is the slowest part of a clean run.
Instead, freeze a fully-indexed workspace once and restore it (over the canonical
path) in seconds.

```bash
# 1. Build the golden archive ONCE (workspace + .keepance index/stores -> .tar).
#    Precondition: the canonical workspace already holds the demo docs and the app
#    is running. Proves isolation + a cited Ask before it freezes the world.
npm run robot:build-snapshot          # -> C:\keepance-snapshots\northcrest-golden.tar (+ .manifest.json)

# 2. From then on, get a clean, fully-indexed world in seconds:
node scripts/robot/cli.mjs reset '{"mode":"snapshot"}'
```

**Safety.** The restore is guarded twice: the Node side refuses to even start unless
`Status` confirms a non-empty archive exists, and `bench/snapshot.ps1` extracts to a
temp dir and only swaps it into place AFTER verifying `.keepance\vectors` is present —
so a missing/partial archive can never destroy the live workspace.

**Portability (important).** A snapshot is **bench-bound and path-bound**: the index
encryption keys live in this machine's OS keychain and the index bakes ABSOLUTE paths.
Build + restore only on the Legion bench, and only to the same workspace path. Moving a
snapshot to another machine would also need its keychain entries transplanted.

## Deterministic AI on the bench smoke

The default smoke runs `deterministic:true`: Ask is answered from a recorded OpenAI
fixture and the egress guard asserts nothing reached a live model.

```bash
# Record the fixture ONCE — against the FROZEN snapshot so the citation markers
# the answer references stay stable on replay:
node scripts/robot/cli.mjs reset '{"mode":"snapshot"}'   # restore the frozen world
npm run robot:record-ask                                 # -> fixtures/ai-replays/ask-portfolio.json

# Default smoke = snapshot reset + fixtured Ask + egress guard:
npm run robot:smoke
# Weekly drift check against the real model (lighter 'fast' reset):
ROBOT_SMOKE_LIVE_AI=1 npm run robot:smoke
```

Why the wire format matters: the Northcrest Ask path uses the **OpenAI** provider
(`src/platform/providers/OpenAIProvider.ts` reads `choices[0].delta.content` +
`choices[0].finish_reason`, skips `data:[DONE]`), so the fixture must be OpenAI frames —
the proxy now emits them when `wireFormat:'openai'`.

## Known limitations / notes

- **`reset({mode:'full'})` wipes the index** (no re-index verb); use `snapshot` (restores
  a built index) or `fast` (keeps the current index) when `ask`/`isolation` must retrieve.
- The bench is a **single serial resource**; the daemon serializes all verbs.
