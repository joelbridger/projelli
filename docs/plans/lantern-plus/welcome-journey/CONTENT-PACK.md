# Lantern Intake Welcome Journey Content Pack

**Purpose:** make the Welcome Journey item dispatchable before code exists.

**Source notes:** this pack is grounded in `docs/plans/lantern-plus/welcome-journey/DESIGN.md`, `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md`, and Wave 5 of `docs/plans/lantern-plus/intake/WAVE-PLAN.md`. In this docs-only worktree, those source files were not present at the requested paths yet, so they were read from the planning branches that contain them. This document does not redesign the Welcome Journey. It turns the decided design into default copy, customization limits, and build acceptance checks.

**Client-facing copy rules:** warm professional advisor voice, light touch, no em dashes, no exact time promises, no sensitive values in email, and client or household language only.

## 1. Default Welcome Journey Template

This is the Lantern default a firm receives before it customizes anything. Bracketed values are merge fields filled by the firm, advisor, client, or intake state.

### Merge fields

| Field | Meaning |
|---|---|
| `[firm_name]` | The advisory firm name shown to the client |
| `[firm_logo]` | Firm logo, if configured |
| `[firm_accent_color]` | Firm accent color, if configured |
| `[client_first_name]` | The client's first name |
| `[household_name]` | Household display name, when the intake is for more than one person |
| `[advisor_first_name]` | Lead advisor first name |
| `[advisor_full_name]` | Lead advisor full name |
| `[support_first_name]` | Main client-service contact first name |
| `[support_full_name]` | Main client-service contact full name |
| `[help_contact_label]` | Firm-chosen help method, such as "reply to this email" or a phone label |
| `[secure_link]` | The active secure intake link |
| `[missing_items_sentence]` | Plain list of missing item labels, never values |
| `[primary_next_item]` | The next checklist item label |
| `[signature_link]` | Approved signing link, when a signing rail exists |
| `[paperwork_label]` | Plain name for the paperwork step, such as "account paperwork" |
| `[new_team_member_full_name]` | Replacement staff member name, used only on handoff |

### Default people

If a firm has not configured its people yet, the template uses these role slots:

| Role | Default client-facing line |
|---|---|
| Lead advisor | "Ask [advisor_first_name] about your planning questions and advice." |
| Client service associate | "Ask [support_first_name] about uploads, signatures, and scheduling." |
| Operations specialist | "Ask our operations team about account paperwork and transfers." |
| Planning analyst | "Ask our planning team about information we are reviewing for your plan." |

For a solo advisor, the team block collapses to one card.

```text
[advisor_full_name]
Lead advisor

Ask [advisor_first_name] about your planning questions, uploads, signatures, and scheduling.
```

### Default timeline

These milestone names match `DESIGN.md`. Firms may rename or hide milestones, but the default is intentionally ready for a solo or small RIA.

| Milestone | Client-facing description | Default owner |
|---|---|---|
| Welcome | "Your secure onboarding page is ready." | Firm |
| Information needed | "Answer the checklist items and upload the requested documents." | Client |
| Reviewing | "Our team checks what you shared." | Firm |
| Paperwork | "We prepare forms, transfers, or signatures." | Firm |
| Signature or transfer | "You review or confirm the next paperwork step." | Client, firm, custodian, or signing provider |
| Active client | "Onboarding is complete and your client record is ready for planning work." | Firm |

### Screen A: first welcome page

```text
Welcome, [client_first_name].

This is your secure onboarding page with [firm_name]. We use it to collect the few things we need, show where you are in the process, and keep you clear on what happens next.

Start with the first item below. You can come back to this page with the same link.

This page locks your information on your device. Only [firm_name] can unlock what you send.
```

Primary action:

```text
Continue secure checklist
```

Next-step card:

```text
Your next step

[primary_next_item]
```

Timeline header:

```text
Where you are
```

Team header:

```text
Your team

These are the people who may help with your onboarding.
```

Help block:

```text
Need help?

[help_contact_label]
```

### Screen B: active checklist support copy

When the checklist is open, the checklist remains the main job. The welcome layer appears beside it or in a small expandable section.

Progress header:

```text
You're partway there.
```

Expandable timeline label:

```text
What happens next
```

Generic item guidance:

```text
Save and continue
```

```text
Skip for now
```

```text
I don't know yet
```

```text
That's okay. We'll help with this one.
```

```text
Replace this answer
```

```text
Provided
```

```text
Provided by phone with [support_first_name]
```

Default item helper lines:

| Item | Helper copy |
|---|---|
| Date of birth | "This helps us identify your household correctly." |
| Social Security number | "Financial institutions use this for account paperwork. Your answer is encrypted on your device before it is sent." |
| Driver's license | "Please add clear photos of the front and back." |
| Income | "A rough answer is okay. We use this to start the planning conversation, not to grade your income." |
| Spending | "A rough guess is genuinely useful. We refine this together." |
| Upload | "A photo is fine if the details are readable." |

Wrong-document helper, when Document Detective has a client-side hint:

```text
This may not be the document we asked for. You can keep it here, or choose a different file.
```

Sensitive-answer confirmation:

```text
Provided

For your privacy, this page does not show that answer again.
```

### Screen C: resume states

Nothing started:

```text
Welcome back, [client_first_name].

Your secure onboarding page is ready. Start with the first item below.
```

Work in progress:

```text
Welcome back, [client_first_name].

You're partway there. The next item is ready below.
```

Advisor reviewing:

```text
We're reviewing what you shared.

You do not need to do anything right now. [support_first_name] will reach out if anything is missing.
```

Paperwork being prepared:

```text
We're preparing the next paperwork step.

You do not need to do anything right now. Your next step will appear here when it is ready.
```

Signature or transfer ready:

```text
Your next step is ready.

Please review the instructions below. If anything looks confusing, [help_contact_label].
```

Active client:

```text
You're all set for this part of onboarding.

Your secure page will stay available so you can check where things stand.
```

Expired link:

```text
This link has expired.

[firm_name] can send you a fresh link.
```

Revoked link:

```text
This link is no longer active.

Please contact [firm_name] if you need help.
```

Completed old link:

```text
This onboarding step is complete.

Please contact [firm_name] if you need to send something else.
```

### Screen D: completion page

```text
Thanks, [client_first_name]. You've sent the information we need to start.

Our team is reviewing it now. If we need anything else, [support_first_name] will reach out.

You can return to this page to see where things stand.
```

Completion page section header:

```text
What happens next
```

Nothing-needed state:

```text
Nothing needed from you right now.
```

Pending paperwork state:

```text
We're preparing [paperwork_label].
```

Pending signature state:

```text
Your signature or transfer step will appear here when it is ready.
```

Ready-to-sign state:

```text
Your paperwork is ready for review and signature.
```

Primary action, when a signing link exists:

```text
Review and sign
```

### Screen E: privacy explainer

This is the plain-language page linked from the first-screen privacy line.

```text
How this page protects your information

This page encrypts your answers and uploads on your device before they are sent.

Only [firm_name] can unlock what you send.

For sensitive items, this page shows a checkmark after you provide them. It does not show the answer or file again.

If you prefer not to enter something here, [help_contact_label].
```

Footer provider line:

```text
Powered by Lantern for [firm_name].
```

### Screen F: staff handoff note

Shown when the visible helper changes during onboarding.

```text
Your team has been updated.

[new_team_member_full_name] can help with uploads, signatures, and scheduling.
```

### Screen G: phone-walkthrough label

Shown when staff completed one or more items during a call.

```text
[support_first_name] helped complete this by phone.
```

### Email 1: welcome email when the link is sent

Subject:

```text
Welcome to [firm_name]
```

Body:

```text
Hi [client_first_name],

We're glad you're here.

Your secure onboarding page is ready:
[secure_link]

Inside, you'll see what we need from you, what happens after each step, and who to contact if anything feels confusing.

First step: [primary_next_item].

Thanks,
[advisor_first_name]
```

### Email 2: link opened but not started

Subject:

```text
Need help getting started?
```

Body:

```text
Hi [client_first_name],

Your onboarding page is ready when you are.

The first step is [primary_next_item]. If you'd rather walk through it together, reply here and [support_first_name] can help.

Thanks,
[advisor_first_name]
```

### Email 3: first item received

Subject:

```text
We received your first item
```

Body:

```text
Hi [client_first_name],

Thank you. We received your first onboarding item.

Next, please continue with the checklist when you are ready:
[secure_link]

If anything feels confusing, reply here and [support_first_name] can help.

Thanks,
[advisor_first_name]
```

### Email 4: document received and next step unlocked

Subject:

```text
We received your document
```

Body:

```text
Hi [client_first_name],

Thank you. We received the document you sent.

The next item is ready on your secure page:
[secure_link]

Thanks,
[advisor_first_name]
```

### Email 5: gentle reminder for missing items

Subject:

```text
A few onboarding items for [firm_name]
```

Body:

```text
Hi [client_first_name],

I wanted to keep this easy to find.

There are a few items left on your onboarding checklist:
[missing_items_sentence]

Same secure page:
[secure_link]

A rough answer is fine where the page says so. If you'd rather walk through it together, reply here and [support_first_name] can help.

Thanks,
[advisor_first_name]
```

### Email 6: checklist ready for advisor review

Subject:

```text
We have what we need for review
```

Body:

```text
Hi [client_first_name],

Thank you for sending your information. Our team is reviewing it now.

If we spot anything missing, [support_first_name] will reach out with a short list. If everything looks ready, we'll prepare the next paperwork step.

Thanks,
[advisor_first_name]
```

### Email 7: item needs another look

Subject:

```text
One onboarding item needs another look
```

Body:

```text
Hi [client_first_name],

Thank you for sending your information.

One item needs another look:
[missing_items_sentence]

You can update it here:
[secure_link]

Reply here if you'd like help.

Thanks,
[advisor_first_name]
```

### Email 8: paperwork ready

Subject:

```text
Your paperwork is ready to review
```

Body:

```text
Hi [client_first_name],

Your paperwork is ready for review.

Please use the link below when you are ready:
[signature_link]

Reply here if anything looks confusing. [support_first_name] can walk through it with you.

Thanks,
[advisor_first_name]
```

### Email 9: signature or transfer state changed

Subject:

```text
Your onboarding step has been updated
```

Body:

```text
Hi [client_first_name],

Your signature or transfer step has been updated.

You can check where things stand here:
[secure_link]

If anything looks confusing, reply here and [support_first_name] can help.

Thanks,
[advisor_first_name]
```

### Email 10: onboarding complete

Subject:

```text
You're all set for the next step
```

Body:

```text
Hi [client_first_name],

You're all set for this part of onboarding.

We'll use what you shared to prepare for your planning conversation. Your secure page will stay available, so you can return to it if you need to check where things stand.

Thanks,
[advisor_first_name]
```

### Email 11: staff handoff

Subject:

```text
A quick team update
```

Body:

```text
Hi [client_first_name],

A quick note that [new_team_member_full_name] can help with your onboarding from here.

Same secure page:
[secure_link]

Reply here if anything feels confusing.

Thanks,
[advisor_first_name]
```

### Email 12: fresh link

Subject:

```text
Here is your secure onboarding link
```

Body:

```text
Hi [client_first_name],

Here is a fresh secure link for your onboarding page:
[secure_link]

You can use this link to continue your checklist.

Thanks,
[advisor_first_name]
```

### Email 13: phone walkthrough follow-up

Subject:

```text
Thanks for walking through onboarding
```

Body:

```text
Hi [client_first_name],

Thank you for walking through part of onboarding with us.

Your secure page is still available here:
[secure_link]

If we need anything else, [support_first_name] will reach out.

Thanks,
[advisor_first_name]
```

### Email 14: email reply confirmed

Subject:

```text
We added your email reply
```

Body:

```text
Hi [client_first_name],

Thank you. We added the information you sent by email to your onboarding checklist.

You can check where things stand here:
[secure_link]

Thanks,
[advisor_first_name]
```

## 2. Firm Customization Points

Firms may edit only the strings and sections listed here. The goal is firm voice without turning the Welcome Journey into a portal builder or marketing tool.

### Editable firm defaults

| Area | Firm may edit | Required guardrails |
|---|---|---|
| Firm identity | Firm name, logo, accent color | Light theme remains the default. Lantern stays invisible unless the firm chooses the provider footer. |
| Welcome page | Headline, intro paragraph, help block, team intro | Must keep the page tied to the same secure intake link. Must not imply an account, portal, or separate site. |
| Primary next-step wording | The short label explaining the next checklist item | Must be a checklist item label or plain instruction, never a sensitive value. |
| Timeline | Milestone labels, milestone descriptions, visible or hidden milestones, owner label | Must keep at least one current milestone and one clear owner for the next move. Milestones remain separate from checklist items. |
| Completion page | Headline, body copy, pending paperwork state, nothing-needed state | Must keep the timeline, next owner, help contact, and calm "nothing needed" state when applicable. |
| Team block | Role names, people, titles, photos or initials, "Ask me about" lines, contact method | For solo advisors, the block may collapse to one person. |
| Help contact | Email reply instruction, phone label, scheduling link label, or named helper | Must not route the client outside the firm-approved path. |
| Email templates | Subject and body for the welcome email and milestone emails | Must keep advisor approval. Must not include SSN, license number, account number, exact balances, or other sensitive values. |
| Milestone email starters | The starter text Lantern uses before an AI rewrite | AI may propose. Advisor must approve. |
| Advisor voice inputs | Firm-approved examples, advisor-approved prior emails, phrases to use, phrases to avoid | No tone dropdown as the primary voice control. |
| Forbidden phrases | Words or phrases the firm does not want in drafts | Product copy checks should honor them before a draft is shown. |
| Compliance footer | Optional firm-authored footer for emails or pages | Footer must stay short enough that the main instruction is not buried. |
| Response expectation | Optional firm-authored availability line | Off by default. Lantern must not invent dates, response windows, or completion promises. |
| Per-client override | Welcome intro, visible team member, help contact, email draft, and allowed next-step language before sending | Overrides are versioned. The client link updates on next load. |

### Not editable by firms

- One secure link for the client.
- No client account.
- No separate welcome-site link.
- The checklist remains the main job.
- AI never sends a client message silently.
- Sensitive values never appear in email copy.
- Submitted restricted values are not shown back to the client page after submission.
- The client page must explain who has the next move.
- The revoked-link page must not show the client name.
- The product must not create a global marketing automation tool.
- The product must not promise dates or exact completion timing unless a human manually writes that promise into a draft.

## 3. Acceptance Criteria For The Wave 5 Welcome Journey Build Lane

Scope note: these criteria cover the Welcome Journey part of Wave 5. Phone-walkthrough intersections are included because `DESIGN.md` binds them to the welcome experience. Firm key sharing and escrow remain governed by the Wave 5 plan and are outside this content pack.

### Product shape

- The welcome journey lives inside Lantern Intake. It is not a separate portal, welcome site, campaign tool, or global work queue.
- The client uses the same secure intake link for welcome, checklist, progress, uploads, completion, and later status.
- The client never creates an account.
- The client page is mobile-first, firm-branded, and light themed.
- The checklist remains the main job. Welcome content supports the checklist and does not bury the next action.

### Default template

- A new firm can send the default template without configuring anything.
- The default template renders every screen and email listed in this content pack.
- The default copy contains no em dashes.
- The default copy contains no exact time promises.
- Default client-facing copy uses client and household language.
- The provider name appears only in the optional provider footer or privacy explainer footer.

### Timeline and next move

- The default timeline ships with the six decided milestones: Welcome, Information needed, Reviewing, Paperwork, Signature or transfer, Active client.
- A milestone is not treated as a checklist item.
- The current milestone is always visible or reachable from the checklist screen.
- The current milestone always has an owner: client, advisor, staff, custodian, signing provider, or outside signature path.
- The page never says only "pending." It explains who has the next move.
- Firms can rename or hide milestones, but the active journey must still show a current milestone and a next owner.

### Resume and completion behavior

- If nothing is started, the link shows the welcome page and first checklist item.
- If work is in progress, the link opens to the next useful missing item and keeps the timeline nearby.
- If the firm is reviewing, the link shows the reviewing state and says nothing is needed from the client.
- If paperwork is being prepared, the link shows the paperwork state and the owner of the next move.
- If a signature or transfer step is ready, the link shows the next action.
- If onboarding is complete, the link shows the final handoff page, not a dead receipt.
- The completion page keeps the timeline, next owner, help contact, pending signature or transfer state, and calm nothing-needed state when applicable.

### Your team block

- The page shows the lead advisor and any support roles the firm has configured.
- Each person card supports name, title, photo or initials, ask-me-about line, and optional contact method.
- A solo advisor setup collapses cleanly to one person.
- Staff changes update the client-visible team block and can generate a handoff draft for advisor approval.

### Firm template editing

- The template editor exposes only the customization points listed in section 2.
- Template hierarchy works in this order: Lantern default, firm default, intake-template default, per-client override.
- After a firm has a default template, the welcome journey section is collapsed by default in the intake composer.
- Advisors can review and change the welcome journey before sending a client link.
- Changes after sending are versioned and reflected on the client page on next load.

### Advisor-approved emails

- Lantern can draft welcome and milestone emails for the triggers in `DESIGN.md`: link sent, link opened but not started, first item complete, document unlocks next step, stalled missing items, ready for advisor review, paperwork ready, transfer or signature status change, onboarding complete.
- Every draft waits for advisor approval before it is saved or sent.
- The approval card includes recipient, subject, body, reason for draft, milestone or missing item, source chips for any facts used, edit area, approve action, and dismiss action.
- If a mailbox connector is available, approval uses the approved mailbox path. If not, the product gives a copy-ready draft.
- No email includes SSN, license number, account number, exact balance, or other sensitive values.
- Drafts must not imply the advisor has reviewed something they have not reviewed.
- Drafts must not sound like Lantern is the sender.
- Advisor edits can be remembered as lightweight voice guidance for later drafts.

### Board and per-client surfaces

- The Onboarding board shows current milestone, checklist progress, who has the next move, last client activity, missing item labels, next message status, and firm owner.
- Welcome journey signals appear as board signal, not as a separate board.
- The Next message cell can show: welcome draft ready, reminder draft ready, paperwork-ready draft ready, no message needed, or client replied by email, confirm match.
- Clicking a message draft opens the approval card in place.
- The per-client Onboarding tab shows current milestone, checklist state, what the client sees, team block, email draft history, approved and sent messages, important onboarding events, and files or facts already added to the Client Map.
- Completed clients leave the active onboarding board according to the firm's chosen archive rule, with a recently completed filter available.

### Phone walkthrough and email fallback

- Phone-walkthrough entries use the same checklist and same source of truth as client-link entries.
- Phone-walkthrough entries are visibly marked to the client as completed by phone when appropriate.
- Phone-walkthrough entries advance the current milestone.
- Phone-walkthrough entries can still trigger welcome or milestone drafts, subject to advisor approval.
- The audit trail records that staff entered the answer.
- If a client replies by email with an answer or attachment, Lantern suggests a match to the same intake session, but the advisor must confirm before the checklist updates.
- Once an email reply match is confirmed, the client timeline can update using the same milestone rules.

### Edge cases

- Household intakes can show both names without exposing one person's sensitive status to the other unless the session is explicitly shared.
- If one household member completes everything, the board shows household status and the other person's missing items separately.
- Expired links show a friendly expired state.
- Revoked links show a neutral inactive state and leak no client name.
- Old completed links never show stale instructions as current.
- Advisor out-of-office or staff-change states can swap the visible helper and draft a handoff note for approval.
- Wrong-document detection belongs to Document Detective, but the welcome journey owns the calm next message.
- Compliance footer support exists, but the main copy stays short and human.

### Copy and quality gates

- A copy test or lint check rejects default client-facing strings with em dashes.
- A copy test or lint check rejects default client-facing strings that contain exact time promises.
- A copy test or lint check rejects sensitive merge fields in email templates.
- Mobile and desktop screenshots show the welcome page, active checklist with timeline nearby, reviewing state, completion page, team block, and approval card.
- Tests prove the same link routes to the correct state for not started, in progress, reviewing, paperwork, signature or transfer, complete, expired, and revoked.
- Tests prove firm customization cannot alter the non-editable product rules in section 2.
- The Wave 5 lane passes the program gate required by `WAVE-PLAN.md`, plus adversarial review focused on silent sends, sensitive email leakage, stale link states, and household privacy.
