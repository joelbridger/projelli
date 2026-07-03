# Wealthbox write-path live probe — results

**Date:** 2026-07-03
**Against:** Wealthbox sandbox account (DEMO-Northcrest tag), via the token in the chmod-600
`~/.config/wealthbox-seed/curl.cfg` (never printed/logged/committed).
**Checklist followed:** `scripts/crm/wealthbox-write-probe.md` (Steps 1-3; Step 4 originally
marked "DEFERRED until Task 9c ships" in that doc — see note below on why it was run anyway).
**Also covers:** the Wave-2 re-test's "Send to Wealthbox now renders + queue + review card +
Approve + disconnect/reconnect, verify no duplicate posts" scope, since both needed the same
live Wealthbox connection.

## Summary

| VERIFY-LIVE item | File:line | Resolution |
|---|---|---|
| `linked_to` type casing | `write.rs:125` | **`"Contact"`** — confirmed |
| Note content/linebreak shape | — | **`"{title}\n\n{body}"` confirmed** — renders correctly |
| `due_date` format for tasks | `write.rs:136` | **Plain `"YYYY-MM-DD"` accepted** — Wealthbox normalizes to `"2026-07-10 12:00 AM -0400"` |
| Is `due_date` required for tasks? | `write.rs:137-144` | **YES — required.** Omitting it returns HTTP 422. **Real gap, not yet fixed in code** (see Finding 1) |
| `CrmTask.created_at`/`updated_at` presence | `write.rs:170` | **Present on the real API** (code's speculative `""` default was overly cautious but harmless) |
| Create-response `id` at top level | `write.rs:542` | **Confirmed top-level**, both notes and tasks |
| `background_information` field write shape | `write.rs:992-1016` (Task 9c) | **Read/write are ASYMMETRIC** — see Finding 2, this is a **live bug**, not just a doc gap |
| Write-path dedup/idempotency | `write.rs:111-131` | **Confirmed working correctly** for genuine retries (same `requested_at`) |

## Step 1 — Note creation (via the real UI flow)

Followed the exact advisor path: opened `Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx`
for the Caldwell, Jennifer client → **Send to Wealthbox** (toolbar button — this is the Wave-2
P0 fix that was being re-tested, and it now renders/works correctly, see the main RUN-LOG) →
the client wasn't yet linked to a Wealthbox household, which surfaced the app's own correct
message ("Link this client to a Wealthbox household first") → ran a normal Wealthbox
**Sync now** (Account → Connections), imported 40 households, which auto-linked Caldwell,
Jennifer to household id `66158044` → the queued note appeared in the **Update Wealthbox**
review card on the Client Map ("Nothing sends until you approve") → clicked **Approve 1
change**.

**Result: PASS.** Note landed in Wealthbox as id `271197631`, linked to the correct contact
(`Caldwell, Jennifer`, id `66158044`, `type: "Contact"`), content rendered exactly as
`"{title}\n\n{body}"` with no reformatting or dropped linebreaks. Confirmed via
`GET /notes/271197631` — full JSON captured, matches what the app sent.

This is the one legitimate "one note" artifact from the probe checklist — left in place in the
sandbox for visual cross-check in the Wealthbox web UI, per the checklist's own suggestion.

## Step 2 — Task creation

The frontend has **no UI trigger for task creation yet** (checked: `enqueueCrmWrite` is only
ever called with `kind: 'note'`, from `MatterNotesEditor.tsx` and `MainPanel.tsx`'s docx
toolbar — `crm_create_task` and the write-queue's task branch are real, tested Rust/TS code,
just not wired to any button). To probe the real Wealthbox API contract without inventing a
fake UI, invoked the Tauri command directly from the app's own devtools console
(`window.__TAURI__.core.invoke('crm_create_task', {...})`) — this exercises the exact same
Rust code path a future UI button would call, it just skips the (nonexistent) click.

**With a due date** (`"2026-07-10"`, one week out): **PASS.** Task landed as id `93501264`,
linked to the correct contact, `due_date` normalized to `"2026-07-10 12:00 AM -0400"`, and —
contrary to the code's speculative empty-string default — **the real API DOES return
`created_at`/`updated_at`** on tasks (both `"2026-07-03 02:10 PM -0400"`).

**Without a due date** (`dueDate: null`): **FAIL — HTTP 422.** Wealthbox rejects tasks with no
due date. **This is a real, unfixed gap**, exactly what the plan's own checklist flagged as a
possibility ("if Wealthbox rejects that, this needs a real client-side validation rule, not a
guess") — see Finding 1 below. Per this probe's instructions, the code was NOT changed; this
is a finding for the fix lane.

## Step 3 — Response shape

Confirmed for both the note and the task above: the `POST /notes` / `POST /tasks` response
echoes the created object's `id` at the top level (not wrapped in `{"note": {...}}` /
`{"task": {...}}`) — matches `remote_id_from`'s assumption in `write.rs:542`. The app's
`crm_create_note`/`crm_create_task` calls returned `remoteId` values that match the ids
visible via a plain `GET` on the same resource.

## Step 4 — Field-level blend (`background_information`) — run anyway, found a real bug

The checklist marks this step "DEFERRED until Task 9c ships" because, as of when that doc was
written, there was no UI path to trigger it. That is STILL true today (no UI calls
`crmUpdateField`/`crm_update_field` — same "backend real, no button yet" situation as tasks
above) — but the Tauri command itself is fully implemented and tested, and the coordinator's
brief for this pass explicitly asked for one field-blend probe against a sandbox contact, so
it was run the same way as Step 2: direct `invoke('crm_update_field', {...})` from the app's
console, exercising the real Rust write path.

**Finding 2 (real bug, confirmed against the live sandbox, code NOT changed):**

`write.rs`'s `wealthbox_wire_field_name` translates the app-facing field name
`"background_information"` to the wire name `"background_info"` for BOTH reads and writes
(`"background_information" => "background_info"`, `write.rs:1016`). Reads are correct — the
real API's `GET /contacts/{id}` does return the field as `background_info`, confirmed. **Writes
are backwards.** Direct testing against the sandbox:

- `PUT /contacts/{id}` with body `{"background_info": "<new text>"}` → **HTTP 200, but the
  field is silently unchanged** (`updated_at` doesn't move either — this isn't a caching
  artifact; confirmed on both the Household record `66158044` and the underlying Person record
  `66158045`, and confirmed with a 5-second wait to rule out propagation delay). Wealthbox
  accepts and appears to succeed, but does nothing.
- `PUT /contacts/{id}` with body `{"background_information": "<new text>"}` (the LITERAL
  app-facing name, i.e. the same string the current code translates AWAY from) → **HTTP 200
  and the field genuinely updates.** Confirmed via a fresh `GET` immediately after.
- Isolated further: a control write to an unrelated field (`job_title`) using its own real
  name succeeded normally either way — this rules out a general PUT-permission problem; it's
  specific to how `background_info`/`background_information` round-trips.

**Net effect if shipped as-is:** the app's `crm_update_field` call for `background_information`
currently returns a SUCCESS receipt (`remoteId` with no error — confirmed: my own probe call
returned `{"remoteId":"66158044","deduped":false}` with no error) while **silently failing to
write anything to Wealthbox.** This is worse than an explicit error — an advisor approving a
field-blend would see "done" and the client's actual CRM record would be untouched. Given
Task 9c's UI is still dormant, this hasn't shipped to any real user path yet, but it must be
fixed (swap the read/write translation, or send both keys) before that UI lane goes live.

**Verification / restoration:** After confirming the bug both ways, restored both the
Household (`66158044`) and Person (`66158045`) `background_info` fields to their original
seed values via a correct-key PUT (using `background_information`, i.e. the one that actually
works) — confirmed via a follow-up `GET` that both are back to their original text. No lasting
change to the sandbox data from this step.

## Wave-2 re-test: disconnect/reconnect duplicate-post check

Ran **Disconnect and delete imported data** on Wealthbox (Account → Connections), then
**Connect Wealthbox** again with the same token, re-imported all 40 households (Caldwell
re-linked to the same household id `66158044` automatically). Confirmed Microsoft 365 stayed
connected throughout (unaffected by the Wealthbox-scoped disconnect).

The already-approved note from Step 1 correctly stayed shown as sent (green check, "0
changes") in the Client Map's review card after reconnect — it was not silently re-queued.

To more rigorously test the actual idempotency mechanism (not just the UI's memory), invoked
`crm_create_note` directly multiple times:

- **First attempt (methodology error on my part, corrected below):** called
  `crm_create_note` three times with the SAME content but a freshly-generated `requestedAt`
  timestamp each time (`new Date().toISOString()`). This created **three separate duplicate
  notes** in Wealthbox (`271197631`, `271198053`, `271198064`). At first this looked like a
  duplicate-write bug — it isn't. Reading `dedup_key()` (`write.rs:111-131`) shows
  `requested_at` (trimmed) is deliberately ONE of the hashed fields — the mechanism is
  content-AND-timestamp-addressed, designed to catch a retry of the exact same approval
  action (same `requested_at`), not to prevent two independently-timed sends of similar
  content (which can be legitimate — e.g. resending a corrected note). My test varied the
  timestamp every call, so of course each looked like a "new" request. **Correcting the test:**
- **Second attempt (correct test — identical `requestedAt` on both calls):** called
  `crm_create_note` twice with the exact same `requestedAt` string
  (`"2026-07-03T18:30:00.000Z"`) and otherwise-identical content. **First call:**
  `{"remoteId":"271198076","deduped":false}` (created normally). **Second call:**
  `{"remoteId":"271198076","deduped":true}` — same `remoteId`, explicitly flagged as a dedupe,
  **no second note created.** Confirmed via Wealthbox: only one note exists for that content.

**Verdict: dedup/idempotency works correctly** for the scenario it's designed for (a retried
approval — e.g. a network blip during the original send). The disconnect/reconnect cycle
itself does not appear to wipe or break the dedup ledger (the correct-methodology retry test
was run AFTER the disconnect/reconnect, and dedup still worked).

**Cleanup note:** the three duplicate notes from my own flawed first test attempt
(`271198053`, `271198064`) plus the dedup-retry probe note (`271198076`) are still present in
the Wealthbox sandbox — the API/token used here does not support `DELETE /notes/{id}` (returns
404; confirmed the notes still exist via a follow-up `GET`, so this is a real API limitation,
not "already deleted"). They're clearly titled ("Annual Review — Meeting Notes" duplicates and
"DEDUP RETRY PROBE — delete me") and harmless test content in a sandbox account — recommend
deleting them manually via the Wealthbox web UI when convenient, not urgent.

## Step 5 — code updates from this probe

Per this task's explicit instructions, **no code was changed.** The two real findings below
are handed to the fix lane:

1. **Task `due_date` is required, not optional** (write.rs:137-144). Either default a due date
   client-side when the user doesn't set one, or add real validation that blocks task creation
   without one (currently: silent 422 failure surfaces as a raw error string to the ledger,
   not a helpful advisor-facing message).
2. **`background_information` write uses the wrong wire field name** (write.rs:1016 /
   `wealthbox_wire_field_name`). The read-side translation (`background_information` →
   `background_info`) is correct for GET; the SAME translation is incorrectly reused for PUT,
   where Wealthbox actually wants the literal `background_information` key. This is a silent
   failure (200 OK, no error, field unchanged) — high priority given Task 9c's UI will surface
   this exact path once wired up. Recommend: either send `background_information` (untranslated)
   for writes specifically, or send BOTH keys in the PUT body for safety against future API
   changes, with a regression test hitting a mocked "accepts one key, echoes old value for the
   other" wiremock scenario to prevent this exact bug recurring silently.
