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

## Non-v2 routes that persist firm input

These are governed by `src/lib/firmPersistentRouteInventory.ts` and proven by
`test/firm-persistent-route-inventory-privacy-proof.test.ts` with the same
database, audit, log, and response sweep.

| Route | Inputs | Rule |
|---|---|---|
| `POST /device/register` | `device_id`, `machine_id`, `pubkey_jwk` | The two IDs must be UUID-shaped opaque handles; the JWK must be a public P-256 key. `label` is rejected. |
| `POST /org/activate` | `license_key`, `machine_id` | The license is checked by hash and never stored in plaintext; the machine ID must be a UUID-shaped opaque handle. `machine_label` is rejected. |
| `POST /org/seats/transfer` | `from_seat_id`, `to_user_id`, `to_machine_id` | The first two are existing server records in the same org; the target machine ID must be a UUID-shaped opaque handle. `to_machine_label` is rejected. |
| `POST /org/claim` | `license_key`, `email`, `password` | Exact, table-owned body shape. The license is hashed for matching; the password is hashed before storage; arbitrary `org_name` is rejected. |

**Device-label decision: option (b), drop it.** The relay only needs a public
key and opaque IDs to route wrapped keys. Device labels were cosmetic, so they
remain local and are neither accepted, stored, returned, nor put in audits.
Opening an older database also clears old `devices.label` and
`seats.machine_label` values.

## Reachable-route audit

| Area | Finding |
|---|---|
| Org claim | Stores a validated account email and password hash only. The former optional caller-chosen firm name has been removed, so this route accepts no free-text client, document, device, or firm descriptor. |
| Seat activation | Now inventory-protected: opaque UUID machine ID only; label dropped. |
| SSO | Persists the administrator's IdP configuration and encrypted client secret. It accepts no matter/client field; login email is only looked up and never written by the SSO-start route. |
| Webhook | Receives LemonSqueezy's signed billing event and stores only billing identifiers/status after signature verification. It has no client-work payload field. |
| Admin | User administration stores account credentials/role; revoke/deprovision use existing server IDs. Seat transfer is inventory-protected; no machine label is accepted. `/admin/org` is billing-network-only provisioning, not a desktop route. |
| Auth | Login, refresh, and logout persist only password/refresh-token hashes and server-minted IDs. They accept no client-work descriptor. |
| Assured proxy | The provider request body is transient opaque bytes and is never parsed, stored, audited, or logged; only provider/model/token-count billing metadata is retained. |
