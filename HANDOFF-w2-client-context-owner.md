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

## Key design decisions (for the reviewer)

- **Owner-wiring lives inside Ask, not client-bar.** The socket is boundary-guarded;
  only Ask-internal code may deep-import `foundation/owner`. client-bar → owner
  would be a boundary violation. Establishment is exposed as a zero-argument
  doorway (`establishAskSharedClientContext`) — it binds ONLY the real store and
  is protected by establish-once, so it is NOT a "set/replace the binding"
  capability. Public export names deliberately avoid `/bind|owner/i` so the
  existing `staleUseIsolation.test.ts` surface check stays green.
- **ClientReference = `SharedClientContext`** (the client-bar published type).
  **MeetingReference = `never`**: this owner owns the CLIENT only. The Meetings
  owner is still absent, so `isMeetingReference` is always false and
  meeting-scoped doorways stay fail-closed (consistent with FOUNDATION_STATUS A3).
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
