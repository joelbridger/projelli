# Wealthbox write-path live probe

**Purpose:** a five-minute manual check against a real Wealthbox account to confirm
the assumptions the CRM write-back code (`src-tauri/src/commands/crm/write.rs`) makes
about the API's request/response shapes — every one of them is currently marked
`VERIFY-LIVE` in the code because it was written from the public API docs, not a real
response. **Do not run this against a production Wealthbox account** — use a sandbox
account or a disposable contact you're fine mutating.

Needs: a real Wealthbox API token (`ACCESS_TOKEN` header value), a workspace with that
Wealthbox account connected, and at least one client/household already matched to a
matter (so a household has a resolvable `crmHouseholdKeys` entry).

## Prereqs

1. Connect Wealthbox in the app (Account → Connections) with the sandbox token.
2. Confirm at least one client on the Client Map has a linked Wealthbox household —
   the review card's household picker needs `buildInverseCrmMap` to resolve one.
3. Have the Wealthbox web UI open in a browser tab, logged into the same sandbox
   account, on that same contact/household's page — you'll cross-check there.

## Step 1 — create one note

1. In the app, on that client's matter, use "Send to Wealthbox" (or however the
   review-card UI exposes it once Task 9's UI lane merges) to enqueue a note with
   distinctive test content, e.g. title "LIVE PROBE — delete me" body
   "Probe run <today's date>."
2. Approve it in the review card.
3. In the Wealthbox web UI, open that contact/household and find the note. Confirm:
   - **Content/linebreaks** — does `"{title}\n\n{body}"` (what `create_note` sends,
     `write.rs`'s `create_note`) render as a two-line note with a blank line between
     title and body, or does Wealthbox split/reformat it unexpectedly?
   - **`linked_to` landed on the right household** — the note shows up under the
     CORRECT contact/household, not a different one.
   - **`linked_to` "type" casing** — if the Wealthbox API or UI exposes the raw
     linked-object type anywhere (e.g. via their own API explorer or a `GET /notes`
     call), confirm whether it's `"Contact"`, `"contact"`, or something else. This
     resolves the `VERIFY-LIVE` at `write.rs:125`.
4. Note the numeric id assigned to this note (visible in the URL or via `GET /notes`).

## Step 2 — create one task

1. Repeat Step 1 for a task instead, with a due date a week out, e.g.
   "LIVE PROBE task — delete me" due `2026-07-10` (adjust to a real near-future date).
2. In Wealthbox, confirm:
   - **`due_date` parsed** — did Wealthbox accept the plain `"YYYY-MM-DD"` string
     `create_task` sends (`write.rs` line ~136), or did it reject/mis-parse it? If it
     needed a different format (e.g. `"2026-07-10 11:00 AM -0400"`), note the exact
     accepted format. Resolves `VERIFY-LIVE: due_date format` at `write.rs:136`.
   - **Was `due_date` actually required?** Try creating a second task through the app
     with NO due date. Does Wealthbox accept a task with no due date, or reject it?
     Resolves `VERIFY-LIVE` at `write.rs:137-144` (currently `due_date: None` is simply
     omitted from the body — if Wealthbox rejects that, this needs a real client-side
     validation rule, not a guess).
   - **Task timestamps** — does `GET /tasks` return `created_at`/`updated_at` fields
     on a task the way it does for notes? Resolves `VERIFY-LIVE` at `write.rs:170`
     (`CrmTask.created_at`/`updated_at` were added speculatively, mirroring `CrmNote`,
     and default to `""` — i.e. "not present" — if absent from the real response).

## Step 3 — confirm the response shape

For BOTH the note and the task created above:

1. Did the `POST /notes` / `POST /tasks` response (2xx) include the created object's
   id at the TOP LEVEL of the JSON body (what `remote_id_from` in `write.rs` assumes),
   or was it wrapped (e.g. `{"note": {"id": ...}}` / `{"task": {...}}`)? Resolves
   `VERIFY-LIVE` at `write.rs:542`.
2. Open the app's local ledger and confirm the recorded `remote_id` matches the id you
   see in Wealthbox for both the note and the task:
   The db is SQLCipher-encrypted (`crm-enc.db`, in the workspace's `.lantern/` folder)
   — the plain `sqlite3` CLI most machines have installed can't open it (SQLCipher's
   `PRAGMA key` needs a `sqlite3` build linked against SQLCipher, e.g. the `sqlcipher`
   package, NOT the stock `sqlite3`). Two practical options:
   - **Easiest:** add a throwaway `#[test]` in `store.rs` that calls
     `CrmStore::open(&real_workspace_path)` (reads the master key from the OS keychain
     automatically) and `outbound_get`/prints every row, run it once, then delete it.
   - **CLI:** install `sqlcipher` (not `sqlite3`), then:
     ```
     sqlcipher <workspace>/.lantern/crm-enc.db "PRAGMA key = \"x'<hex master key>'\"; \
       SELECT dedup_key, status, remote_id, created_at FROM crm_outbound_writes;"
     ```
     The master key is in the OS keychain under the `lantern-crm-enc` service
     (`identity::CRM_ENC_SERVICE`, `src-tauri/src/identity.rs`), `master-key-v1`
     account — read it with the OS keychain tool, e.g. macOS
     `security find-generic-password -s lantern-crm-enc -a master-key-v1 -w`.
3. Confirm `status = 'sent'` for both rows and `remote_id` matches what you saw in
   Wealthbox.

## Step 4 — field update (blended note) — DEFERRED

Task 9c (field-level blended updates, `crm_update_field`) is UI-bearing and has not
merged as of this probe being written — there is no field-update code path to test
yet. **Skip this step** until Task 9c ships, then extend this checklist with: blend
`background_information` on the sandbox contact, verify the merged text landed intact
and no OTHER field on the contact changed, and confirm the `PUT /contacts/{id}`
envelope shape assumed in Task 9c's plan section.

## Step 5 — write every confirmed shape back into the code

For each `VERIFY-LIVE` comment touched above, replace the speculative note with the
confirmed shape (or file a follow-up ticket if it turned out wrong and needs a real
fix, e.g. a due_date format change or a required-field validation). Current locations:

| File:line | What it says today | What to confirm |
|---|---|---|
| `write.rs:125` | `linked_to` type casing unconfirmed | `"Contact"` / `"contact"` / other |
| `write.rs:136` | `due_date` format unconfirmed | plain date vs. datetime+timezone string |
| `write.rs:137-144` | whether `due_date` is required for tasks | required / optional |
| `write.rs:170` | whether `CrmTask` has `created_at`/`updated_at` | present / absent on real API |
| `write.rs:542` | whether the create response echoes `id` at top level | top-level / wrapped |

If any of these turn out different from what the code assumes, fix the code (not just
the comment) and add a regression test proving the corrected behavior — do not leave
a "confirmed wrong but unfixed" comment behind.
