# Lantern Intake Wave 2 Prep Pack

**Purpose:** make Wave 2 dispatchable as soon as Wave 1's intake rails land on `lp/intake`.

**Source notes:** this prep was written from the Intake plan set on `lp/intake`: `WAVE-PLAN.md`, `PRODUCT-DESIGN.md`, `ARCHITECTURE.md`, and `W1-EXEC-PLAN.md`. In this docs-only worktree, those files were not present at the requested path yet. Wave 1 status at prep time: Lane A contracts are merged on `lp/intake`; B, C, and E are building; D advisor-side rails are queued. Treat the Wave 1 Lane D store paths below as grounded plan guesses until the final Wave 1 diff lands.

## Wave 2 Goal

Ship the advisor-side work surface around active intake:

- Onboarding board inside the client hub area.
- Nudge drafts that the advisor reviews and saves through their own connected mailbox.
- Link lifecycle signals on the board, layered on Wave 1 link controls.
- Intent and outcome audit rows for every approved nudge action.

Wave 2 must keep the Intake product promise intact: AI proposes, the advisor decides; user-facing copy says client or household; the app stays light themed; no client-submitted values leave the E2EE flow; no nudge sends itself.

## Dispatch Shape

Recommended branch fan-out after Wave 1 is merged:

| Lane | Branch | Primary owner | Depends on |
|---|---|---|---|
| Board UI | `lp/intake-w2-board-ui` | Codex build, Claude review | Wave 1 `src/platform/intake/intakeStore.ts` or final equivalent |
| Nudge engine | `lp/intake-w2-nudges` | Codex build, Claude review | Board selectors, final client email field, `mailSaveDraft` rails |
| Link lifecycle UI | `lp/intake-w2-link-lifecycle` | Codex build, Claude review | Wave 1 link controls and relay link event shape |

Merge order recommendation: board UI first, link lifecycle second, nudge engine third. The board gives the other two lanes one place to render. Nudge engine should be last because it touches mail, AI drafting, cadence rules, and audit.

## Lane 1: Board UI

**Outcome:** the Onboarding board is a first-class work view. It shows every active onboarding request, sorted by what needs the advisor first.

### File path guesses

Grounded existing anchors:

- `src/features/matters/MattersHome.tsx` is the current clients surface and already owns the client table, `SurfaceToolbar`, `TodaysMeetingsStrip`, and the `MatterHub` mount.
- `src/features/matters/MatterHub.tsx` owns per-client tabs through `HUB_TABS` and renders `overview`, `documents`, `email`, and `meetings`.
- `src/platform/matter/matterStore.ts` defines `ClientMapHubTab`, currently `overview | documents | email | meetings | activity`.
- `src/platform/state/appNavigationStore.ts` persists `clientMapHubTab`, so adding an onboarding tab needs this type path to keep navigation snapshots valid.
- `src/app/lifecycle/useGlobalEventBus.ts` maps client row actions into hub tabs.
- `src/locales/en.json`, `src/locales/es.json`, and `src/locales/de.json` hold visible strings.
- `src/ui/kp/` has the shared `Button`, `IconButton`, `Badge`, `Card`, `SurfaceToolbar`, and related light UI pieces.

Expected Wave 1 anchors:

- `src/features/intake/*` for advisor Intake UI.
- `src/platform/intake/intakeStore.ts` for non-sensitive checklist state.
- `src/platform/intake/factsStore.ts` for masked fact access only. Board UI should not read restricted values.
- `src/platform/intake/IntakeSyncClient.ts` for sync state and event hydration.

Proposed new or changed files:

- `src/features/intake/OnboardingBoard.tsx`
- `src/features/intake/OnboardingBoardRow.tsx`
- `src/features/intake/OnboardingBoardEmptyState.tsx`
- `src/features/intake/onboardingBoardSelectors.ts`
- `src/features/intake/OnboardingTab.tsx`, only if Wave 1's tab is not already complete enough to reuse.
- `src/features/intake/__tests__/OnboardingBoard.test.tsx`
- `src/platform/intake/boardSelectors.ts`, if selectors are shared with nudges and link signals.
- `src/platform/matter/matterStore.ts`, add `onboarding` to `ClientMapHubTab`.
- `src/features/matters/MatterHub.tsx`, add the Onboarding tab and panel.
- `src/features/matters/MattersHome.tsx`, add a board view toggle beside the client list if the lead keeps the board at the client-list level.
- `src/app/lifecycle/useGlobalEventBus.ts`, route an explicit onboarding launch to the hub tab.
- `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`, add board, row, empty, and tab strings.

### Behavior proposal

- Board row data should be derived from Wave 1 state, not recomputed from sealed values:
  - `matter_id`
  - `request_id`
  - `kind`
  - item states
  - required item count
  - accepted or received count
  - missing item labels
  - last client activity timestamp
  - pending advisor review count
  - link status
  - nudge eligibility summary
- Sort order:
  1. items awaiting advisor review
  2. stalled clients, most stalled first
  3. link lifecycle signals that need action
  4. quietly progressing clients
  5. complete but unreviewed clients
- Row actions:
  - open the client's Onboarding tab
  - review new items
  - open the nudge draft if one is eligible
  - copy link again
  - show link signal details
- The row must show missing item labels only, never submitted values or file names.
- Empty state: no active onboarding requests. Primary action should reuse the existing New client path, not create a second intake entry point.

### Acceptance criteria

- The board appears as a first-class client work view and uses the existing light UI system.
- Rows answer: who is onboarding, what is missing, when they last acted, and what the advisor should do next.
- Clicking a row opens that client's Onboarding tab in `MatterHub`.
- The board never renders SSNs, license numbers, file names, or any restricted fact fragment.
- The board uses stable `data-testid` values for every row action.
- Board copy is in locale files, not hardcoded in components.
- Tests cover sorting, missing-item rendering, stalled state, row click routing, and restricted-value redaction.

## Lane 2: Nudge Engine

**Outcome:** Lantern drafts a warm follow-up tied to the missing intake items, then the advisor approves it. No automatic sending.

### File path guesses

Grounded existing anchors:

- `src/platform/utils/mail-commands.ts` exports `mailSaveDraft()` and `composeMailAccountId()`. `mailSaveDraft` saves into Outlook or Gmail Drafts and never sends.
- `src/features/email/DraftFollowUpModal.tsx` already shows the safe review pattern for AI-generated email drafts.
- `src/features/email/followUpDraft.ts` already has prompt-safety helpers, structured output handling, citation verification, and `draftBodyToHtml()`.
- `src/features/email/emailAuditLog.ts` has `logEmailAuditEntry()` and `emailMatterScope()`, used when email-adjacent UI needs to write into the live audit log.
- `src/platform/types/audit.ts`, `src/app/shell/common/AuditLog.tsx`, and `src/features/audit/auditHomeHelpers.ts` need updates for any new audit action string.
- `src/features/email/resolveEmailProvider.ts` handles AI-provider selection for email drafting.

Expected Wave 1 anchors:

- `src/platform/intake/intakeStore.ts`, final source for last client activity, item state, missing items, nudge count, and link URL.
- Final client email location from Wave 1's New client compose flow.

Proposed new or changed files:

- `src/platform/intake/nudgePolicy.ts`
- `src/platform/intake/nudgeDraft.ts`
- `src/platform/intake/nudgeAudit.ts`
- `src/platform/intake/nudgeStore.ts`, only if Wave 1 `intakeStore` should not own nudge attempts.
- `src/features/intake/NudgeDraftCard.tsx`
- `src/features/intake/NudgeReviewModal.tsx`
- `src/features/intake/__tests__/nudgePolicy.test.ts`
- `src/features/intake/__tests__/NudgeDraftCard.test.tsx`
- `src/platform/types/audit.ts`, add the final nudge audit action string or strings.
- `src/app/shell/common/AuditLog.tsx` and `src/features/audit/auditHomeHelpers.ts`, add labels/icons for new nudge audit rows.
- `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`, add review UI strings.

### Engine proposal

- Start with deterministic templates from the copy pack below.
- Let AI rewrite only the body text if the advisor chooses "Draft in my voice".
- The code, not the model, controls:
  - recipient
  - subject
  - link
  - missing item list
  - cadence guard
  - whether a call is suggested
- The nudge draft must reference only currently missing items.
- If the client acts after a draft is opened, the draft becomes stale and must be regenerated before save.
- If no draft-capable mailbox exists, show "copy message" and a setup action. Do not call `mailSend`.
- If the account is IMAP only, block mailbox draft saving because `mailSaveDraft` does not support IMAP.

### Cadence acceptance criteria

- A client cannot receive more than one nudge per four days.
- After three unanswered nudges, the board stops offering another email nudge and suggests a call.
- "Unanswered" means no new client activity has landed for that request after the last approved nudge action.
- A bounced item with no client activity follows the same cadence guard.
- The engine must count approved nudge actions from durable state, not only in-memory React state.
- The guard must be tested across app restart or state rehydrate.
- The UI must explain the guard in plain language when it blocks a nudge.

### Audit acceptance criteria

- Before saving an approved nudge draft, write an intent row with:
  - `matter_id`
  - `request_id`
  - nudge sequence number
  - missing item ids, not values
  - provider/account identity
  - `audit_pair_id`
- After `mailSaveDraft` succeeds, write an outcome row with:
  - same `audit_pair_id`
  - provider draft id
  - recipient count
  - no email body
  - no restricted values
- If the draft save fails after intent, write a failed outcome row.
- The audit row shape should mirror the CRM intent/outcome pattern in `src-tauri/src/commands/crm/commands.rs`.

## Lane 3: Link Lifecycle UI

**Outcome:** link state and link trouble signals are visible where advisors act, without exposing client-submitted data.

### File path guesses

Grounded existing anchors:

- `src/features/matters/MatterHub.tsx` is the per-client tab shell.
- `src/features/matters/MattersHome.tsx` is the board/list shell.
- `src/ui/kp/Badge`, `Callout`, `IconButton`, and `SlidePanel` match the current UI language.

Expected Wave 1 anchors:

- `src/features/intake/LinkControls.tsx` or equivalent, from Wave 1 Lane D.
- `src/platform/intake/intakeStore.ts` for link status.
- `src/platform/intake/IntakeSyncClient.ts` for relayed link events.
- `backend/src/routes/intake.ts` final event shape for expired, revoked, wrong-token, and new-device signals.

Proposed new or changed files:

- `src/features/intake/LinkLifecyclePanel.tsx`
- `src/features/intake/LinkSignalBadge.tsx`
- `src/features/intake/LinkSignalDetails.tsx`
- `src/platform/intake/linkSignals.ts`
- `src/features/intake/__tests__/linkSignals.test.ts`
- `src/features/intake/__tests__/LinkLifecyclePanel.test.tsx`

### Behavior proposal

- Per-client Onboarding tab keeps the Wave 1 controls:
  - copy link again
  - extend
  - turn off link
  - regenerate
- Board rows show signals:
  - active
  - expires soon, if Wave 1 exposes an expiry threshold
  - expired and opened
  - revoked and opened
  - new device submission
  - duplicate or replay flagged by sync
  - regeneration available
- Signals should use warm amber for attention and neutral copy. Avoid alarm language unless the link is clearly revoked or anomalous.
- Expired-link attempts are a useful follow-up signal, not an error.
- Revoked-link attempts must not show the client name on the public page. The advisor UI can show the client because the advisor is authenticated locally.

### Acceptance criteria

- The board shows expired-link attempts and anomaly flags without revealing submitted values, file names, or last-4 fragments.
- Link controls remain one-click visible in the per-client Onboarding tab.
- Regenerating a link keeps already received items and kills the old link.
- A board signal can be dismissed only if it is informational. Security or integrity flags stay visible until the underlying issue is resolved.
- Tests cover each signal state and verify no restricted values are rendered.

## Nudge Copy Pack

These are baseline templates. The nudge engine may use them directly, or use them as the fixed scaffold for an AI rewrite. The merge fields are code-owned, not model-owned.

### Merge fields

| Field | Meaning |
|---|---|
| `{{client_first_name}}` | Client first name or household greeting |
| `{{advisor_first_name}}` | Advisor first name |
| `{{firm_name}}` | Firm name |
| `{{missing_items_list}}` | Plain list of missing item labels |
| `{{primary_missing_item}}` | The most important missing item label |
| `{{intake_link}}` | Active intake link |
| `{{advisor_phone}}` | Advisor phone number |
| `{{advisor_calendar_link}}` | Optional scheduling link |

### Nudge 1: gentle

**Subject:** A few onboarding items for {{firm_name}}

**Body:**

Hi {{client_first_name}},

I hope you are doing well. I saw a few onboarding items are still open:

{{missing_items_list}}

Whenever you are ready, you can use the same link to keep going:

{{intake_link}}

If anything on the list is hard to find, that is okay. Send what you have, and we can help with the rest.

Best,

{{advisor_first_name}}

### Nudge 2: helpful with link

**Subject:** Here is your onboarding link again

**Body:**

Hi {{client_first_name}},

Just putting your onboarding link back at the top of your inbox:

{{intake_link}}

The main item still open is {{primary_missing_item}}. If you are unsure about it, a rough answer or the closest document you have is useful. We can clean it up together.

Thanks,

{{advisor_first_name}}

### Nudge 3: suggest a call

**Subject:** Want help finishing your onboarding?

**Body:**

Hi {{client_first_name}},

It looks like {{primary_missing_item}} is still getting in the way. That is normal for client paperwork.

If it would be easier, reply here or call me at {{advisor_phone}}, and we can walk through it together. You can also book a call here:

{{advisor_calendar_link}}

Your link is still here if you prefer to finish it yourself:

{{intake_link}}

Best,

{{advisor_first_name}}

## Cross-Lane Tests

- Board fixture with three clients: one awaiting review, one stalled with nudge eligible, one complete.
- Cadence fixture: no nudge before four days, eligible after four days, call suggestion after three unanswered nudges.
- Mail fixture: approving a nudge saves a draft through `mailSaveDraft` and records intent/outcome audit rows.
- Stale draft fixture: missing items change after draft opens, save is blocked until regeneration.
- Link signal fixture: expired-link attempt appears on the board, revoked-link attempt appears only in advisor UI, new-device submission is flagged.
- Redaction fixture: render the board, nudge review, and link signal details with restricted facts present in store; assert no SSN, last-4, license number, or file name appears.

## Open Questions For The Wave Lead

1. What is the final Wave 1 `intakeStore` shape? Confirm item states, last client activity, link status, nudge history, and link-signal fields before dispatch.
2. Where does Wave 1 store the client's email address? The current `Matter` type does not have an email field.
3. Does "approve" in Wave 2 mean save a mailbox draft through `mailSaveDraft`, or actually send with `mailSend`? The plan names `mail_save_draft`, but the Wave 2 bench line says sent mail.
4. Should nudge audit rows use one new action with `phase: intent | outcome`, or two explicit action strings? Either way, update both audit UIs.
5. Are expired-link attempts and new-device signals already exposed by the Wave 1 relay, or does Wave 2 need a small relay event addition?
6. Should the Onboarding board be a toggle inside `MattersHome`, or a separate top-level app surface? Recommendation: keep it inside `MattersHome` so it stays with the client hub.
7. Should AI voice matching ship in Wave 2, or should Wave 2 start with deterministic templates and leave "draft in my voice" as a secondary button?
