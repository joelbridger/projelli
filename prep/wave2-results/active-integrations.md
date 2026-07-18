# Active integrations fix-round result

## Source state and evidence binding

- Branch: `v1/active-integrations`
- Original approved base: `a197c9c2073f1b561070db9be52d6a7f35f4847d`
- Fix-round launch tip: `2a91f8d9c19610f6cc0c5ff393556644abdc6741`
- Last code tip (the exact tree checked):
  `28d34cc007ae2b2affffe448b89b5f424bc3ee22`
- Final evidence tip: the commit containing this report
- Final commits after the code tip: evidence only
- Rust/native work: **NO**

This follows the ruled evidence convention: checks bind to the exact last code
tip above. The only path after that code tip is this report:

```text
$ git diff 28d34cc007ae2b2affffe448b89b5f424bc3ee22..HEAD --name-only
prep/wave2-results/active-integrations.md
```

## Outcome

The Account registry appends one default-off **Active integrations** section.
When enabled, it reads the existing `connections` cards through the public
`@/features/account` doorway and renders only each card's own `renderStatus()`
and `renderSafeDisconnect()` output.

No connector, provider operation, credential path, OAuth flow, Account host,
shell route, client selection path, or Rust file changed. The section adds no
disconnect operation or status store.

Each shown card has:

- its existing translated connector label;
- connector-owned status and access/capability content;
- the connector-owned safe disconnect control;
- an honest omission notice if a runtime-malformed card lacks a required
  renderer.

If the public descriptor read fails validation, the section fails closed with
an unavailable state and does not guess status or controls. After an
interaction with a connector-owned disconnect control, it performs a fresh
public descriptor/render read. It also observes later connector-owned UI
changes and refreshes without copying provider-specific success logic.

## F1: Privacy Center diagnosis and cure

The disputed Settings test was run from an isolated detached worktree at the
exact approved base. The scratch worktree used the repository's already
installed dependencies; no lane source was present.

```text
$ git rev-parse HEAD
a197c9c2073f1b561070db9be52d6a7f35f4847d

$ npx vitest run src/app/shell/SettingsSurfaceFlagGate.integration.test.tsx

 RUN  v4.1.3 /home/jameson/lantern/app/integration/.worktrees/base-activeint-proof

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  18:18:25
   Duration  7.57s (transform 4.60s, setup 373ms, import 5.85s, tests 971ms, environment 280ms)
```

**Register note:** the Settings test is green at the base, so the earlier
`privacy-center-scroll` failure is not registered as pre-existing. This lane
owns the acceptance debt. The Account registry proof now follows the real
registry-enumeration pattern: with the flag dark it asserts the unchanged four
section ids; with the flag enabled it asserts the complete five-id order,
selects the one real `active-integrations` descriptor, renders that real
descriptor, and asserts the real `active-integrations-section` panel. The
final focused run below also executes the disputed Settings test and is green.

The historical machine receipt remains truthfully RED and unedited at
`evidence/self-check-receipt-b82cfabbb94d.txt`. It records the earlier broad
gate observation; this report does not relabel that historical run.

## F2: non-vacuous provider-operation proof

The opening test's `providerCall` spy is now on the rendered control's actual
code path:

```text
connector-owned button onClick -> disconnect spy -> providerCall spy
```

The section is rendered with that card, then the test asserts that opening it
invokes neither `disconnect` nor `providerCall`. This proof can now fail if the
rendered disconnect control is invoked during opening. The separate click test
continues to prove that a user click invokes the connector-owned control and
causes a fresh public registry read.

## Flag-off and public-contract proof

`active-integrations` is appended once with `defaultEnabled: false`,
`ownerLane: 'active-integrations'`, creation date `2026-07-18`, and expiry date
`2026-09-16`.

The real `getAccountSectionDescriptors()` doorway applies the feature gate
before returning the descriptor. With the flag off, there is no Active
integrations descriptor or tab, so the child is not mounted and its public
card reader is not called. With the flag on, the same registry returns exactly
one descriptor and its renderer mounts the real section.

The canonical public card projection contains 16 ordered `connections` cards.
Every one supplies callable status and safe-disconnect renderers. All child
imports from Account use `@/features/account`; there is no private connector
import.

## Fresh final checks at `28d34cc007ae2b2affffe448b89b5f424bc3ee22`

### Focused suite

```text
$ npx vitest run src/features/account/active-integrations/ActiveIntegrationsSection.test.tsx src/features/account/accountRegistries.test.tsx src/features/account/connectionCardPublicDoorway.test.tsx src/app/shell/SettingsSurfaceFlagGate.integration.test.tsx

 RUN  v4.1.3 /home/jameson/lantern/app/integration/.worktrees/v1/active-integrations

 Test Files  4 passed (4)
      Tests  16 passed (16)
   Start at  18:22:56
   Duration  15.54s (transform 27.36s, setup 4.70s, import 36.78s, tests 2.71s, environment 3.08s)
```

### Application type check

```text
$ npm run typecheck
> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit
exit=0
```

### Test type check

```text
$ npm run typecheck:tests
> advisor-prep-hero@3.3.5 typecheck:tests
> tsc -p tsconfig.test.json --noEmit
exit=0
```

### Feature boundaries

```text
$ npm run boundaries:check
> advisor-prep-hero@3.3.5 boundaries:check
> node scripts/check-boundaries.mjs

✅ No feature-boundary regression (599 current baseline finding(s)).
exit=0
```

Touched-test ESLint, Prettier, and `git diff --check` also passed against the
same code tree.

## Attestations

1. **Fresh checks:** every reported final check ran after the last code edit at
   the exact code tip above.
   `[attest: yes + 28d34cc007ae2b2affffe448b89b5f424bc3ee22]`
2. **Scope:** source paths remain limited to the active-integrations package,
   the append-only Account registry contribution and focused registry test,
   and the appended flag descriptor. This fix round changes only two granted
   tests plus this evidence report.
3. **Guard integrity:** no test, validation, type, timeout, snapshot, baseline,
   or manifest was weakened. The provider assertion was strengthened by wiring
   it to an observable rendered path.
4. **Contracts:** all cross-feature production use remains through the public
   Account doorway; all displayed controls remain connector-owned.

Ready for coordinator re-review. The launcher alone owns the completion
sentinel.
