# Batch-2 evidence drive — 2026-07-15/16

Separation-of-duties evidence lane. This session did NOT modify any product code — it only
built the debug desktop binary (already warm/cached, no source changes) and drove the real
app. All screenshots below are from the actual running app, not mocked.

**Build under test:** `merge/combined` @ **f4667c7a1a34ea748c252c49331cf297efbefbeb**
(worktree: `/home/jameson/lantern/app/integration`, clean tree, `git status` verified before
and after the drive).

**Packaged/debug binary:** `src-tauri/target/debug/lantern`
SHA256 `fe86665393fa20d65c073c4704a5aa92483575194e9e315d7f735b9be4f78ecb`
Built via `CARGO_TARGET_DIR=/mnt/devcache/cargo-target-combined cargo build --manifest-path
src-tauri/Cargo.toml` — this target dir was already warm for this exact branch/SHA (build
finished in ~1s, i.e. it was already compiled at this tip before this session started), and
`src-tauri/target` in this worktree is a pre-existing symlink to that same shared dir. No
Rust/product source was changed to produce this binary.

**Method:** real desktop app, not the browser dev server, for all 5 features (stronger
evidence: it exercises the actual Tauri/SQLCipher persistence path, not just localStorage-in-a-tab).
Driven headlessly via `scripts/crm-loop/launch-app.sh` (Xvfb virtual display `:120`) +
`scripts/desktop-drive.mjs` (the repo's own dev-bridge HTTP driver, by `data-testid`) +
`scrot` for pixel screenshots. Flags were toggled at runtime via the app's documented dev
override (`localStorage['lantern:feature-flags']`, read by `src/platform/flags/router.ts`),
which is the same mechanism the app's own flag tests use.

**Restart method (stronger than a page reload):** `kill -TERM` on the actual `lantern`
process (confirmed both the app and its Xvfb both exited), then a fresh
`scripts/crm-loop/launch-app.sh 9270 /tmp/crm-evidence-ws1` against the **same** workspace
directory. The relaunch log shows `OS data dir: AlreadyMigrated` (vs `FreshInstall` on first
launch), confirming the same on-disk profile was reopened, not a new one. This is a real
process restart, not `location.reload()`.

## Verdicts

| # | Feature | Flag | Ledger row | Verdict |
|---|---|---|---|---|
| 1 | Form activity | `form-activity` | JP-042 | **PASS** (with one methodology note below) |
| 2 | Internal projects | `internal-projects` | WB-031 | **PASS** (one HONEST GAP: not record-linked) |
| 3 | Firm custom fields | `custom-fields-firm` | WB-124 | **PASS** |
| 4 | Contact sources | `contact-sources` | WB-153 | **PASS** |
| 5 | Notification preferences | `notification-preferences` | WB-118 / JP-058 | **PASS** |

---

### 1. Form activity — `form-activity` — JP-042

Flag ON → nav shows **Form activity** (`crm-home-nav-form-activity`); flag OFF → absent
(`screenshots/09-flags-off-nav-absence.png` vs the flag-on nav in
`screenshots/00-flags-on-crm-home.png`).

`FormActivitySurface` is a **read-only derived view**: it reads `intakeLink` /
`intakeSubmission` CRM records and renders a decision-status table. There is no in-app
"submit a form / make a match decision" surface owned by this ticket — that pipeline
(receiving link, submitting, deciding match/create/reject) is a separate, larger surface not
in scope for `form-activity` itself (confirmed by reading `selectors.ts` and the module's own
docstring: *"This surface intentionally does not create, match, or review a submission; those
actions keep their owners."*).

**Methodology note (read before trusting this as "the owed durability drive" verbatim):** to
populate real input data, I wrote one `household`, one `intakeLink`, and one
`intakeSubmission` (status "create", i.e. "Contact created") record directly through the
same `crm_live_upsert_many` Tauri command the app's own screens use to save data (the
identical mechanism `scripts/crm-loop/seed-workspace.mjs` uses for CRM fixtures elsewhere in
this repo). I did **not** drive an actual intake-link submission UI end-to-end (none is wired
in this build for this ticket). What this proves: the **real SQLCipher-backed persistence and
the real `FormActivitySurface` UI**, restart-durable. What it does NOT prove: an end-to-end
"advisor sends a form → client fills it out → advisor decides" flow — that's out of this
ticket's scope per the module's own docs, so I'm not treating its absence as a form-activity
failure, just flagging the boundary honestly.

Before restart (`screenshots/08-form-activity-before-restart.png`):
`New Client Intake · Dana Alvarez · Alvarez Household · Jul 15, 2026, 11:59 PM · Contact created`

After a real process restart (`screenshots/15-form-activity-after-restart.png`): identical row,
byte-for-byte same values, confirmed via both the rendered UI and the underlying record set
(`crm_live_list` still returns the record).

### 2. Internal projects — `internal-projects` — WB-031

Flag ON → nav shows **Internal projects**; flag OFF → absent (same before/after pair as
above).

**HONEST GAP:** the ledger names this ticket "Record-linked projects" and its Wealthbox-parity
description implies a project tied to a specific client/household record. The shipped
`internal-projects` surface has **no client/matter link field** — its own colocated test
(`internalProjects.test.tsx`) explicitly asserts a saved project `not.toHaveProperty('matterId')`,
and its own copy says *"Internal firm work that is **not** tied to a client."* This is a
genuine scope/naming mismatch worth a ledger correction, not a persistence bug — the feature
that DID ship (a firm-level project tracker: name, category, owner, status, due date,
milestones, collaborators) works and persists correctly; it's just not "record-linked."

Created project "Northcrest Compliance Review" (category Compliance, owner Jordan Ade, status
In progress). Before restart: `screenshots/02-internal-projects-saved-before-restart.png`.
After a real process restart: `screenshots/11-internal-projects-after-restart.png` — same
project, same fields, `localStorage['lantern:crm:internal-projects:v1']` byte-identical to the
pre-restart value.

### 3. Firm custom fields — `custom-fields-firm` — WB-124

Navigate: Settings gear → Organization → "Custom fields" panel. Flag OFF → the entire
**Organization** settings category itself disappears from the rail (not just the panel) —
see `screenshots/10-flags-off-settings-rail-absence.png` vs `03-settings-rail-my-settings-present.png`
(flag on).

One real prerequisite discovered during this drive, not previously documented in the brief:
this panel calls through `src/platform/crm/liveRecords.ts`, which has **no browser
fallback** and requires an actually-open CRM workspace — saving without one fails cleanly
with "Open a workspace before saving CRM data." (this is correct, safe behavior, not a bug).
I opened a real workspace via the same `crm_set_workspace` + `useWorkspaceStore.setRootPath`
call the repo's own `scripts/crm-loop/*.mjs` fixtures use.

Defined field "Risk Tolerance Notes" (kind Text, applies to Households). Before restart:
`screenshots/06-custom-fields-saved-before-restart.png` ("Custom field catalog saved."). After
a real process restart (workspace reopened the same way, since auto-resume is intentionally
disabled under `LANTERN_TEST_MODE=1`): `screenshots/13-custom-fields-after-restart.png` — the
field is still in the catalog, unchanged.

### 4. Contact sources — `contact-sources` — WB-153

Same Organization settings screen, "Contact sources" panel — visible together with custom
fields in `screenshots/12-contact-sources-and-custom-fields-after-restart.png`.

Added a new source "Webinar," then renamed it to "Webinar (2026 series)." Before restart
(`screenshots/04-contact-sources-added-renamed-before-restart.png`): panel shows
`ID: webinar` with `Earlier names: Webinar` — i.e. the rename-history claim in the panel copy
("Renaming... never changes source IDs or labels already saved on contacts") is backed by an
actual `historicalLabels` array, not just UI copy.

After a real process restart: `screenshots/12-...png` shows the same source, same ID
(`webinar`), same "Earlier names: Webinar" line — both the new source and the historical label
survived. Raw `localStorage['lantern:crm:contact-sources:v1']` confirmed identical before/after
restart including the `historicalLabels: ["Webinar", "Webinar (2026 series)"]` array.

### 5. Notification preferences — `notification-preferences` — WB-118 / JP-058

Flag ON → a **new personal settings section** appears in the settings rail, labeled
"My settings" (`settings-category-personal`), containing the "Notification preferences" panel.
Flag OFF → the "My settings" rail entry is entirely absent (compare
`screenshots/03-settings-rail-my-settings-present.png` to
`screenshots/10-flags-off-settings-rail-absence.png` — the flag-off shot has no "My settings"
row at all, confirming this section is genuinely new, not a relabeled existing one).

Changed defaults: unchecked "Mentions" (was on), switched future-delivery from "Right away" to
"Daily digest." Before restart: `screenshots/07-notification-preferences-set-before-restart.png`.
After a real process restart: `screenshots/14-notification-preferences-after-restart.png` —
Mentions still unchecked, Daily digest still selected.
`localStorage['lantern:notification-preferences:local-user']` byte-identical before/after.

---

## Unrun / not attempted (honest gaps)

- **No in-app nav entry for opening a workspace headlessly** is a known, pre-existing matrix
  item (per the brief) — I used the same direct `crm_set_workspace` +
  `useWorkspaceStore.setRootPath()` call the repo's own fixture scripts use, not a fabricated
  workaround.
- **Pixel-level side-by-side comparison against the frozen prototype** was not performed for
  any of the 5 features — I did not have a running instance of the frozen prototype in this
  session to screenshot against. The one-line parity notes above are based on reading the
  shipped code/tests and the ticket descriptions in `V1-TRACEABILITY-LEDGER.md`, not a visual
  diff. Flagging this so it isn't mistaken for a verified pixel-parity pass.
- **Packaged (release) binary was not built** — only the debug binary (`cargo build`, not
  `tauri build` / `cargo build --release`). The brief allows either; debug was sufficient to
  exercise the real persistence layer and is what `scripts/crm-loop/launch-app.sh` (this
  repo's own evidence-driving convention) is built around.
- **form-activity's upstream submission pipeline** was not driven end-to-end — see the
  methodology note under item 1. This is a scope boundary in the shipped code, not something
  I skipped for convenience.

## Compile-window / bench discipline

Posted a compile-window note to `~/lantern-coordination/BOARD.md` before building
(`cargo build` against the shared `/mnt/devcache/cargo-target-combined`); no other cargo
process was active at the time (checked `ps aux` first). Vite held port 5174 as the single
consumer for the duration of this drive per the brief; released at the end of this session.
No product code was edited — `git status` was clean at the start and remains clean now
(only files added are under this `evidence/` directory).
