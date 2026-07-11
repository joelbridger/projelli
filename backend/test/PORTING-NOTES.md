# Firm relay v2 test porting notes

The earlier v2 change accidentally replaced these suites with three small smoke
tests. This round restores the original proof obligations against the v2
protocol. The three files now run 100 tests in total: 36 relay tests, 48 wiring
tests, and 16 store/access tests.

| Old suite | Old cases | V2 treatment |
| --- | ---: | --- |
| `sync-relay.test.ts` | 36 | All cases are retained: authorization, wall-wins, cross-org hiding, seat and ticket rules, duplicate/idempotency, ordered cursor pull, blob limits, rate-limit shape, HTTP error shape, stream isolation, WebSocket ready/update/presence, ticket single-use, and the fixed ticket-only socket URL. Old document-id cases now prove separate random `stream_handle` routes and that frames/responses omit route identifiers. |
| `firmwiring.test.ts` | 48 | Device, admin/device lookup, key publication/fetch, membership discovery, wall/key rotation, member list, and v1 upgrade checks are retained. The old matter-key paths are now `/v2/firm/matters/:matter_handle/...`; discovery asserts handles/root streams only. Name-bearing create/wall payload checks are transformed into rejection checks. Existing non-relay org plumbing remains covered by its v2-compatible route behavior. |
| `matters.test.ts` | 16 | All ACL/store cases are retained: member/default-deny/admin/wall/cross-org policy, auditing, byte-preserving ciphertext storage, idempotency, cursor ordering, isolation, epoch rotation, and size-bound sanity. `matter_id` and `doc_id` are replaced by opaque matter and stream handles. |

No behavior was dropped. The only wording transformations are privacy-required:

- old `client_name` echoes become assertions that the field is absent or rejected;
- old `matter_id` route assertions become opaque `mh2_` handle assertions;
- old `doc_id` routing and fan-out assertions become opaque `sh2_` stream routing
  and frames with neither handle serialized;
- the old default `_notes` stream is the newly generated root stream.

The dedicated privacy proof records the complete v2 HTTP/WebSocket flow and
checks sentinel metadata against traffic, errors, audit events, routes, frames,
and database text fields. The migration proof uses a file-backed legacy SQLite
fixture and verifies relation mapping, row counts, byte equality, cleanup, and
a real v2 pull followed by client-side decrypt simulation.
