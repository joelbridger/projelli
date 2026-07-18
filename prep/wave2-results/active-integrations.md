# Active integrations result

## Source state

- Branch: `v1/active-integrations`
- Launch base: `a197c9c2073f1b561070db9be52d6a7f35f4847d`
- Final verified source commit: `b82cfabbb94d8094ea907ac5ad093359ffcd950b`
- Source commit state: clean before the machine receipt was generated
- Rust: **NO**

## Outcome

The Account registry now appends one default-off **Active integrations**
section. When enabled, the section reads the existing `connections` cards
through `@/features/account` and renders only each card's own `renderStatus()`
and `renderSafeDisconnect()` output.

No connector, provider operation, credential path, OAuth flow, Account host,
shell route, client selection path, or Rust file was changed. The section adds
no disconnect operation or status store.

Each shown card has:

- its existing translated connector label;
- connector-owned status and access/capability content;
- the connector-owned safe disconnect control;
- an honest omission notice if a runtime-malformed card lacks a required
  renderer.

If the public descriptor read itself fails validation, the section fails
closed with an unavailable state and does not guess status or controls.

After an interaction with a connector-owned disconnect control, the section
performs a fresh public descriptor/render read. It also observes later UI
changes from an asynchronous connector-owned result and refreshes the public
read without copying provider-specific success logic.

## Public-contract preflight

PASS at the launch base.

- The slate safety grep returned `1`, meaning zero protected navigation,
  shell, client-context, matter-store, or CRM-home matches in the granted
  attachment files.
- `@/features/account` publicly exports the canonical validated
  `getConnectionCardDescriptors()` reader.
- The real `connections` projection contains 16 ordered cards, and the focused
  registry proof confirms every one supplies callable `renderStatus` and
  `renderSafeDisconnect` renderers.
- Whole-source-scope scan at the verified source commit found no private
  connector import. Every import from the child to Account uses
  `@/features/account`.

## Flag-off proof

`active-integrations` is appended once with `defaultEnabled: false`,
`ownerLane: 'active-integrations'`, creation date `2026-07-18`, and expiry date
`2026-09-16`.

The real `getAccountSectionDescriptors()` doorway calls the outer feature gate
before it receives the descriptor. With the flag off, the focused registry
test proves there is no Active integrations descriptor or tab. Therefore the
child is not mounted, its state is not created, and the public card reader is
not called. With the flag on, the same real registry returns exactly one
descriptor and its renderer mounts `ActiveIntegrationsSection`.

## Fresh final checks at `b82cfabbb94d8094ea907ac5ad093359ffcd950b`

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:tests` | PASS |
| Focused Vitest: active-integrations package, Account registry, public Account doorway | PASS, 3 files / 14 tests |
| `npm run boundaries:check` | PASS, no regression; 599 current baseline findings |
| `npx vitest run tests/unit/architecture-boundaries.test.ts` | PASS, 1 test |
| `node scripts/ui-system/handle-guard.mjs` | PASS, no removed or newly ambiguous handles |
| `npx vitest run tests/unit/i18n/en-json-snapshot.test.ts` | PASS, 5 tests |
| ESLint on every touched TS/TSX file | PASS |
| `git diff --check a197c9c2073f1b561070db9be52d6a7f35f4847d..HEAD` | PASS |
| Whole-source-scope protected-path/private-connector scan | PASS, zero forbidden matches |

The machine receipt is
`evidence/self-check-receipt-b82cfabbb94d.txt`. Its individual `typecheck`,
`typecheck:tests`, `handle-guard`, `arch-dag-guard`, `i18n-snapshot`,
`boundaries:check`, and focused steps all passed. The focused receipt step ran
the feature directory and passed 4 tests.

The receipt's overall result is truthfully **RED** because its broader
`gate:changed` step hit the five-minute cap after reporting one failure in
`src/app/shell/SettingsSurfaceFlagGate.integration.test.tsx`. An isolated rerun
reproduced that unrelated failure: 1 passed, 1 failed because
`privacy-center-scroll` was absent. A source comparison confirms this lane
changed neither that test nor any `src/features/settings` file. Those paths are
outside this grant and were not edited.

`COORDINATOR:` the inherited Settings surface test above remains red and needs
owner triage outside this lane. The required checks for the granted Active
integrations source are green; the receipt is intentionally not represented as
green.

## Review status

- Worker self-review: PASS. The full base-to-source diff contains only the ten
  granted source paths. No private connector import, copied provider operation,
  alternate status store, unsafe disconnect route, flag default, suppressed
  test, weakened assertion, timeout, snapshot, baseline, or manifest change
  was found.
- Independent Sol review: **NOT RUN IN THIS LANE**. The coordinator launch
  delta explicitly says reviews are coordinator-arranged. No review result is
  fabricated here.

## Product and contract decisions

1. The existing `connections` placement is the complete candidate list;
   developer tools are not shown in this firm-integration section.
2. Connector cards remain the only authority for status, access/capability
   truth, confirmation, result handling, and disconnect behavior.
3. A malformed card is omitted; a failed public read shows an unavailable
   state. Neither path synthesizes connection truth.
4. A connector-owned UI interaction causes a fresh public read. Later
   connector-owned UI changes cause another fresh read so asynchronous success
   does not leave the section presenting its earlier render.
5. The host registry and Account window remain unchanged except for the one
   append-only public section contribution.

## Attestations against the final source commit

1. **Fresh checks:** every reported required check ran after the last source
   edit. `[attest: yes + b82cfabbb94d8094ea907ac5ad093359ffcd950b]`
2. **Scope:** every source path is authorized: the new
   `src/features/account/active-integrations/` package, the append-only Account
   registry import/default contribution and its focused test, and the appended
   flag descriptor. The mandated receipt and this result are evidence only.
   `[attest: yes | list authorization above]`
3. **Guard integrity:** no test, validation, type, timeout, snapshot, baseline,
   or manifest was weakened. `[attest: yes]`
4. **Contracts:** all cross-feature use is through the public Account doorway
   and all shown controls are connector-owned. `[attest: yes]`

Ready for coordinator review. The launcher owns the completion sentinel.
