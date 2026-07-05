# Build brief — the RECORDING NOTICE KIT (Jameson-approved 2026-07-04): provable participant notice without a bot

**Lane:** cc-lantern-noticekit · dir `~/lp-noticekit` (own worktree, branch `lp/recording-notice-kit`). **Model:** Opus 4.8 · high (compliance-evidence correctness-critical — coordinator-stated reason).
**Read FIRST:** `docs/strategy/2026-07-04-recording-notice-brainstorm.md` — the design rationale Jameson approved (Tier 1 = your scope; Tier 2 is explicitly NOT in scope). Then the existing consent machinery: `src/features/meetings/ConsentDialog.tsx`, `consentLedger.ts`, `recordingConsentLaw.ts`, `meetingStore.ts` (the notesError/needs-review patterns from QA-31 are your stylistic template for honest failure states).
**Rules:** NO-SHORTCUTS (core compliance surface). TDD — red-first for every behavior. Self-converge via `codex-review --base origin/lantern-plus` run FOREGROUND/watched, ≥2 clean-adjacent rounds (this is consent/evidence code — the security/isolation bar applies). i18n complete (en/de/es; keep i18n:check at 0; the en-json snapshot test needs its documented regen procedure). Unique dev-server port. PULL + reconcile before handoff.

## Lane boundary (two other lanes are live)
- **transfix** owns the transcription PIPELINE (Rust ParakeetSidecar, transcribe_meeting internals). You NEVER touch those. Your verification reads the COMPLETED transcript artifact (transcript.json) after the pipeline finishes — a consumer, not a participant.
- If you need to touch `meetingStore.ts`, keep to additive hooks (post-transcription callback / new fields) — if you find yourself editing tryGenerateNotes/transcription plumbing, STOP and ask (`COORDINATOR:` plain text).
- qa5 is an explorer on bench-2 — irrelevant to your files.

## The four pieces (all of them — Jameson said fully implement)

### 1. Verified verbal notice — the centerpiece
- The ConsentDialog gains a first-class "say this out loud" step: shows the exact notice script (localized; firm-customizable via settings with a sane default: "Quick note before we start — I'm recording this meeting for my notes. The recording stays on my computer. Is that alright with everyone?"). The advisor already attests today; keep that, add the script display prominently.
- **Post-transcription verification:** when a meeting's transcript lands, scan the FIRST N minutes (default 5, constant) for the notice. Fuzzy matching, not exact-string: people paraphrase. Design the matcher deliberately (normalized tokens; look for the semantic core — a "record(ing)" term + a first-person disclosure shape + optionally the consent ask; the custom-script setting should feed the matcher its expected phrases too). Localized matching for de/es. Unit-test the matcher hard: paraphrases that must PASS ("I'm going to record this call for notes, okay?"), decoys that must FAIL ("they record everything these days", "I never record meetings").
- **Found:** consent ledger gets a `verbal-notice-verified` entry: timestamp into the audio (ms), the matched transcript snippet, matcher confidence. Surface it in the meeting page (a small "Notice verified at 0:14" chip near the consent info) and in the ledger view.
- **Not found:** the meeting gets a needs-review item — honest, non-accusatory copy ("No spoken recording notice was detected in this meeting's first 5 minutes") — with one-click resolutions: "Disclosed in advance (invite/chat)" / "Notice was given — transcription missed it" / "Acknowledge gap". Every resolution writes a ledger entry with who/when.
- Verification is fully local (the transcript never leaves the machine — nothing new here, just say it in the module docs).

### 2. Advance notice in the calendar invite
- Investigate what calendar WRITE capability exists today (the app syncs M365 + Google calendars — find whether invite-body editing via the existing Graph/Google integrations is already within granted scopes). Then:
  - **If write is feasible within existing scopes:** a per-meeting "Add recording notice to invite" action (and a per-firm auto setting) appends the standard disclosure block to advisor-organized events; ledger stores the disclosure text + when it was added.
  - **If write needs new OAuth scopes/vendor work:** implement the honest fallback — a one-click "Copy invite disclosure" (standard block on the clipboard + guidance), ledger self-attested entry, and file the scope upgrade as a clearly-documented follow-up in your handoff. Do NOT wire new OAuth scopes yourself without flagging first.
- The disclosure copy (localized, firm-customizable): "This meeting will be recorded by [advisor name] for note-taking. The recording stays on [his/her] computer and is never uploaded. Questions? Please ask before we begin."

### 3. One-click chat notice
- At recording start (post-consent-dialog), offer "Copy recording notice for the meeting chat" — pre-written line to clipboard, ledger records `chat-notice-copied` with timestamp. Small, visible, done.

### 4. The firm policy dial
- Settings (firm-level, near the existing confidentiality/consent settings): **Notification policy — Standard / Strict.**
  - **Standard (default):** everything above active; missing verbal notice ⇒ needs-review flag.
  - **Strict:** a recording whose verbal notice is NOT verified stays **quarantined** — meeting visible but marked unresolved-in-review; its notes/transcript still accessible (never destroy data) but the meeting card carries the unresolved-notice state until a human resolves it via the one-click options. No auto-delete, no auto-stop (deliberate — see the strategy doc).
- The state-law model (`recordingConsentLaw.ts`) should suggest Strict as the recommended setting for two-party states (a gentle recommendation line in settings, not an override).

## Evidence story (why this feature exists — get it right)
Every notice event is a ledger entry bound to the meeting: invite disclosure (text + timestamp), chat notice (timestamp), verbal notice (audio timestamp + snippet), attestation, and resolutions. The meeting page shows the notice trail compactly. Keep the existing disclaimer everywhere relevant: guidance, not legal advice.

## Gate + handoff
Red-first tests throughout (matcher table-driven suite; ledger entries; needs-review lifecycle; Strict quarantine; settings persistence). `npx tsc --noEmit` · `npm run typecheck:tests` 0 · `npm run i18n:check` 0 · full `npx vitest run` · eslint-gate · Rust untouched expected (if you genuinely must touch Rust, own CARGO_TARGET_DIR=$HOME/.cargo-target-lp-noticekit + timeout 1200 + one cargo box-wide). Verify visually once in the browser dev build (unique port): consent dialog script step, notice-verified chip, needs-review flow, settings dial — screenshots in the handoff. Evidence-required handoff: HEAD SHA · gate counts · calendar-write feasibility verdict · matcher design notes · self-review rounds · screenshots. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/recording-notice-kit`

## Landmines
Never rename matter_id/Matter. No cloud calls for verification (transcript scan is local). AI_AUTHOR stays "Advisor Prep Hero AI". No interactive menus — `COORDINATOR:` plain text for blockers/decisions, then proceed on stated defaults where reasonable.
