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
| `reset` | `{mode:'fast'}` (default) purges residue + reseeds + reloads, KEEPS the index. `{mode:'full'}` kills the app, deletes the `.keepance` index, restarts, reconnects, reseeds. | advisor profession + 26 matters seeded |
| `open` | Opens the Northcrest recent workspace from the launcher and dismisses the first-run feature tour. No-op if already open. | main UI (spine nav) mounted |
| `sweep` | Clicks every top-level surface (settings, privacy, audit, workflows, email, files), screenshots each. | every surface reachable |
| `ask` | Self-navigates into a client's Ask, asks a question, waits for the answer to settle, reports citation chips / attestation / "not cited" warning. | settled AND attestations > uncited warnings |
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
- `bench.mjs` — SSH/scp/tunnel + app kill/restart/index-delete/port-wait (lifted from `legion-clean-reset.sh`).
- `verbs/*.mjs` — one file per verb (ported from the matching `legion-*.mjs`).
- `server.mjs` — the resident daemon (serializes verbs; reconnect-and-retry on a dropped page).
- `cli.mjs` — thin client (daemon by default, `--no-daemon` to run inline).
- `smoke.mjs` — the end-to-end proof (`npm run robot:smoke`).

## Recording an AI replay fixture (the determinism fast-follow)

The replay infra is built + unit-tested, but the demo's Ask currently runs the **live**
model (`deterministic:false`) because a *provider-accurate* fixture has not been recorded
yet. To make Ask deterministic:

1. Run Ask once with network logging and capture the provider's SSE response
   (the app uses OpenAI in the Northcrest demo, so the wire format is OpenAI's
   `choices[].delta.content`, not the Anthropic `content_block_delta` the proxy emits today).
2. Either save the chunks to `scripts/robot/fixtures/ai-replays/ask-portfolio.json`
   AND teach `aiReplay.mjs` to emit the matching wire format, or switch the demo seed
   to an Anthropic provider+key so the existing Anthropic-format proxy matches.
3. Flip the Ask default back to `deterministic:true`.

## Known limitations (fast-follow)

- **Ask runs the live model** until the fixture above is recorded (see report §6-B).
- **`reset({mode:'full'})` wipes the index** but there is no `index`/`open+reindex` verb
  yet, so `ask`/`isolation` need `mode:'fast'` (default) which preserves the index.
- The bench is a **single serial resource**; the daemon serializes all verbs.
