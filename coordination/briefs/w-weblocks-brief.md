# Build brief — migrate TabWriteGuard's locking substrate to the Web Locks API

**Lane:** cc-lantern-weblocks · dir `~/lp-weblocks` (own worktree, branch `lp/web-locks-guard`). **Model:** Sonnet 5 · high.
**Rules:** NO-SHORTCUTS (this is data-loss-guard code). TDD. Stay in your lane: `src/platform/browserGuard/**`, its App.tsx wiring, and its tests ONLY. Self-converge via `codex-review --base origin/lantern-plus` (run it in FOREGROUND or watch it — backgrounded codex gets killed under fleet load; verify the process finished, don't wait on a dead one). PULL + reconcile before handoff. Unique dev-server port. No interactive menus.

## Context (read the code + LANES history first)
The single-writer browser tab gate (merged @4f26f151) works and is well-tested, but its custom heartbeat + compare-and-set-over-localStorage protocol needed SEVEN review rounds to close real races (bfcache lock drops, tab-duplication co-ownership, stale-reclaim rehydration, late flushes from demoted owners, uncorrelated flush-acks). The browser's native **Web Locks API** (`navigator.locks.request`) eliminates the whole class: the browser serializes ownership itself — no polling, no heartbeat, no reclaim races, automatic release on tab death (including crash/bfcache eviction).

## What to build
Swap the locking substrate under TabWriteGuard to Web Locks while KEEPING: the exact UX (TabGateOverlay, takeover flow, blocked-tab-never-mounts-AppShell invariant), the flush-and-ack handshake with per-request nonce (still needed — a lock grant doesn't guarantee the previous owner flushed), the desktop/Tauri + test-mode disablement, and the existing test suite's behavioral guarantees (port the tests; the fake-channel/fake-storage seams should become a fake-locks seam). Feature-detect: browsers without `navigator.locks` (rare, but be honest) fall back to the current heartbeat implementation — do NOT delete it; select substrate at guard init. Document the two substrates in the module header.

## Gate + handoff
All existing browserGuard tests green (ported where seams changed, behavior identical) + new substrate-specific tests (lock acquired/blocked/auto-released-on-close via a fake locks impl) + one live two-tab Playwright run on a unique port (manual takeover + close-tab auto-handoff). `npx tsc --noEmit` · i18n:check 0 · full `npx vitest run` · eslint-gate. Handoff: HEAD SHA, gate counts, what changed vs kept, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/web-locks-guard`
