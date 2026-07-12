# Firm Relay v2 client-input inventory

Every input below is either a random opaque handle, a number, a value minted
or verified by the server, or a fixed binary envelope. No readable client
label is accepted by a v2 route.

| Route | Client input | Classification | Rule |
|---|---|---|---|
| `POST /v2/firm/matters` | body | verified-and-never-stored | Must be `{}`. |
| `POST /v2/firm/matters/list`, `/mine` | body | verified-and-never-stored | Must be `{}`. |
| `POST /v2/firm/matters/:matter/*` | `:matter` | strictly-validated opaque handle | Exact `mh2_` 256-bit handle. |
| activate, archive, members/list | body | verified-and-never-stored | Must be `{}`. |
| members/add | `user_id`, `role` | server-derived | Existing same-org user; fixed server role enum only. |
| members/remove, wall/set, wall/clear | `user_id` | server-derived | Existing same-org user. |
| streams/release | `stream_handle` | strictly-validated opaque handle | Exact `sh2_` handle belonging to the matter. |
| keys/publish | `epoch` | numeric | Positive current server epoch. |
| keys/publish | `wrapped[].user_id` | server-derived | Existing same-org user. |
| keys/publish | `wrapped[].device_id` | server-derived | Registered device owned by that user. |
| keys/publish | `wrapped[].wrapped_key_b64` | binary-envelope | Canonical base64 of fixed 145-byte `LWK` v1 envelope; stored as BLOB. |
| keys/fetch | `device_id` | server-derived | Registered device owned by caller. |
| `POST/GET /v2/firm/streams/:stream/*` | `:stream` | strictly-validated opaque handle | Exact `sh2_` 256-bit handle. |
| updates/push | `blob_id` | strictly-validated opaque handle | Exact `bh2_` 256-bit handle. |
| updates/push | `ciphertext_b64` | binary-envelope | Canonical base64 v2 envelope: version byte, IV, and GCM tag minimum. |
| updates/push | `key_epoch` | numeric | Positive integer. |
| updates/push | `seat_token` body / `X-Seat-Token` | server-minted | Signed active-seat token; never stored verbatim. |
| updates/pull | `since` query | numeric | Safe non-negative integer; sole allowed pull query key. |
| sync-ticket | body | verified-and-never-stored | Must be `{}`. |
| WebSocket `/v2/firm/sync` | `ticket` query | server-minted | Single-use server-minted 256-bit ticket; sole allowed socket query key. |
| every authenticated v2 route | `Authorization` | verified-and-never-stored | Signed access token; never stored verbatim. |
| WebSocket upgrade | `Upgrade` | verified-and-never-stored | Literal `websocket`; other headers are ignored and never persisted. |

The table-driven privacy proof in `test/firm-relay-privacy-proof.test.ts` sends
the hostile sentinels through the v2 boundary and checks every SQLite column
(including BLOBs), audit records, responses, captured logs, and WebSocket
frames for their absence.
