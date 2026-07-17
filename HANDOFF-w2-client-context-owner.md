# Handoff — seam-client-context-owner (Wave 2, Opus build lane)

**Branch:** `v1/w2-client-context-owner` (worktree off `merge/combined` @ `1612006ac`).
**Role:** builder only. Independent Sonnet review + from-scratch bypass round happens next.

## What this lane delivered (the two coupled parts, one owner)

1. **Publicized the shared client context** from `@/features/client-bar`:
   - `SharedClientContext` (type) + `useSharedClientContext()` (React hook) +
     `readSharedClientContext()` (non-React live read).
   - All three are a projection of the ONE true shared client store
     (`@/platform/client-context` `useClientContextStore`) — NOT a parallel
     store. Switching/clearing the client is the same switch every tool sees.
   - Files: `src/features/client-bar/sharedClientContext.ts` (new),
     `src/features/client-bar/index.ts` (export added).

2. **Wired the Ask owner binding** — the single owner-wiring module:
   - `src/features/ask/sharedClientContextOwner.ts` (new). Co-located INSIDE the
     Ask feature (the only place allowed to reach the boundary-guarded owner
     socket `createAskSharedClientOwner`). It binds the socket to the live shared
     client and reads the store on EVERY call, so switches/clears propagate live.
   - Publicized on `@/features/ask` (safe, minimal): `establishAskSharedClientContext`
     (zero-arg → disposer), `readAskSharedClientSnapshot`, `toAskClientSnapshot`,
     `askClientIdentityAdapter`. NONE of these can inject an arbitrary client
     reader; the raw owner socket stays off the public surface.
   - The module binds against the PLATFORM shared-client store
     (`@/platform/client-context`) directly — NOT the client-bar feature — so the
     Ask feature depends only on the platform layer (allowed by the architecture
     DAG). It is the same store the client bar reads/writes, so both observe the
     identical live selection.

## Key design decisions (for the reviewer)

- **Owner-wiring lives inside Ask, not client-bar.** The socket is boundary-guarded;
  only Ask-internal code may deep-import `foundation/owner`. client-bar → owner
  would be a boundary violation. Establishment is exposed as a zero-argument
  doorway (`establishAskSharedClientContext`) — it binds ONLY the real store and
  is protected by establish-once, so it is NOT a "set/replace the binding"
  capability. Public export names deliberately avoid `/bind|owner/i` so the
  existing `staleUseIsolation.test.ts` surface check stays green.
- **ClientReference = platform `SharedClientIdentity`** (the true shared-client
  type; client-bar's published `SharedClientContext` is a structurally identical
  view of the same store). Binding against the platform type keeps the Ask
  feature off any cross-feature edge (see arch-dag note below).
  **MeetingReference = `never`**: this owner owns the CLIENT only. The Meetings
  owner is still absent, so `isMeetingReference` is always false and
  meeting-scoped doorways stay fail-closed (consistent with FOUNDATION_STATUS A3).
- **Architecture DAG (arch-dag-guard):** the owner module imports ONLY the
  platform layer + intra-Ask files — no `ask -> client-bar` (or any other
  undeclared) cross-feature edge. An earlier revision imported client-bar's
  `SharedClientContext` type and tripped `tests/unit/architecture-boundaries.test.ts`;
  the guard flags type-only imports too. Fixed by depending on the platform store
  directly. The allowlist/DAG rules were NOT modified.
- **matterId := householdId, revision := hash of identity content.** Until a
  dedicated matters owner lands, one household is its own matter scope. This is
  the honest minimal mapping of the only real client data, not a lookalike
  CRM/matter owner contract. Documented inline in `sharedClientContextOwner.ts`.
- **No Ask foundation internals were modified** — only a new co-located module +
  barrel export lines. The stop-rule (no ask-foundation API change) was NOT hit;
  establish-once reconciled with the real client-bar state cleanly.

## Fixtures (owned path `src/foundation-contracts/client-context/`)

- `pavedPath.import.ts` — compiling app-side wiring example (public surfaces only).
- `sharedClientContextBinding.test.ts` — 7 isolation tests: A→B→none held
  read/open/list handles; async-wait crossing; save-handle crossing A→B/none then
  works again under A; establish-once second-binder-throws; freeze-class
  (live re-read, sealed openers); release fails-closed; no public bind/owner
  capability on Ask or client-bar.

## Verification (see RECEIPT for exact output)

tsc 0 · eslint 0 (changed files) · boundaries green (no regression, ownerImportBoundary
still green) · focused vitest 7 files / 33 tests pass (new suite + staleUseIsolation +
ask/foundation + client-bar), plus shell SharedClientBar + platform client-context 9 tests.

## Notes / not-done

- Live-app mounting (a shell effect calling `establishAskSharedClientContext()` at
  boot) is intentionally NOT wired here — that is the shell owner's lane (A1, still
  absent). This lane provides the owner-wiring + the public doorway + the tests.
- Full repo test suite and full-repo eslint were NOT run (focused per brief).
- `node_modules` in the worktree is a symlink to the integration repo's (pinned
  TypeScript 5.6.3); it is gitignored.
