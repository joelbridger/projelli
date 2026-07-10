# Lantern Intake — Product Design
**Author:** dedicated Intake design session (Fable 5), 2026-07-10, per `../INTAKE-DESIGN-BRIEF.md`.
**Companions:** `ARCHITECTURE.md` (E2EE + threat model), `WAVE-PLAN.md` (build order), `QUESTIONS-FOR-JAMESON.md`, `RISKS.md`.
**Grounding:** pain analysis `docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md` (P1–P10), raw field research of 2026-07-09, Jameson's locked decisions of 2026-07-10.

---

## 1. What this is

Lantern Intake is how a new client's life enters the practice. The advisor presses **New client**, composes a short checklist from a template, and sends one link. The client opens it on their phone, walks through the items one at a time, types the sensitive things into a page that encrypts them in their own browser, uploads the documents they can find, and says "I don't know" to the ones they can't. Everything they provide lands, decrypted only on the advisor's machine, in that client's folder — indexed, cited, and feeding the Client Map from day zero. The advisor watches every in-progress client on one Onboarding board, and when someone stalls, Lantern drafts the polite follow-up and the advisor approves it with one click.

It answers, in one flow, the pains that are killing deals today: no secure single form (P1–P3), prospect drop-off after "yes" (P4), untracked awkward follow-up (P5), portal-hating clients (P6), and the clunky "getting to know the firm" phase (P7).

**Identity rule (board stance):** Intake is not a forms product. It is the front door of the private intelligence layer. The demo moment is not "look, a form" — it is the Client Map visibly growing as intake items arrive.

### Design principles

1. **One link, no account, no portal.** The client never creates a login. The link is theirs, branded as the firm, with their name on it.
2. **A conversation, not a form.** One item at a time, plain words, progress always visible, "I don't know" is always a legal answer.
3. **Write-only for secrets.** Once a client submits their SSN or a license scan, even they can't re-view it on the page (they see "Provided, ending in 1234"). A leaked link can never read back what was already given.
4. **Ask once, never re-ask.** Everything collected becomes a structured client fact with provenance. Downstream paperwork (Schwab forms, ACATS, RightCapital) prefills from it. The firm never asks the client for their SSN twice.
5. **AI proposes, the advisor approves.** Every AI action (matching an emailed document to a checklist item, extracting income from a statement, drafting a nudge) follows house rules: propose-then-approve, receipts, audit rows.
6. **Honest by construction.** The page tells the client, in one sentence, what the firm can honestly say: "This page encrypts your information on your device. Only [Firm] can read it." No claim we can't back in the architecture doc.
7. **Light theme, mobile-first, firm-branded.** The client side is a phone experience first. Light background, firm logo and accent color, generous type.

---

## 2. The objects

| Object | What it is | Lives where |
|---|---|---|
| **Intake** | One onboarding effort for one client: a checklist, a link, a status. A client has at most one active intake. | Attached to the client (internally the matter; `matter_id` on the wire, never renamed) |
| **Checklist item** | One ask. Has a type (typed field, document upload, question), a friendly label, help text, required/optional, and a state. | Inside the intake |
| **Intake link** | The URL the client opens. Carries the decryption-free secret in the fragment (see ARCHITECTURE.md). Can be expired, revoked, regenerated. | Generated on the advisor machine |
| **Client fact** | A structured, provenance-carrying answer (DOB, SSN, income figure...). The "ask once" layer. | Advisor machine, encrypted at rest |
| **Nudge** | A drafted follow-up message tied to what's missing, awaiting advisor approval. | Advisor machine; sent through the advisor's own email |

### Item types (v1 catalog)

- **Typed field** — short structured entry with validation: date (DOB), SSN (with format help and masking as they type), currency amount, free text.
- **Document upload** — camera capture or file pick; can require multiple sides/parts (license front AND back is one item with two slots, not two items).
- **Guided question** — a soft-structured ask like monthly spending: offers a number, a range picker ("roughly between..."), or "I don't know yet."
- **Read-only step** — a welcome or what-happens-next card (used at start and end; no input).

### Item states

```
Not started → In progress → Provided (client submitted)
            → Marked unknown ("I don't know")           → advisor sees a gentle flag
Provided → Received (synced + decrypted on advisor machine)
Received → Accepted ✓  |  Needs another look (advisor writes one plain sentence; item reopens for the client)
```

The client sees only: to do / done / "we'll help with this one." The advisor sees the full state machine. "Days stalled" = days since the client's last activity on the intake, computed on the advisor side.

### The v1 default template ("New household") — Jameson's locked field set

1. Welcome card (firm intro, what this is, how long it takes: "about 10 minutes plus a few documents")
2. Date of birth — typed field
3. Social Security number — typed field, write-only, masked
4. Driver's license — document upload, two slots (front, back), camera-first on mobile
5. Income — guided question (exact number, or range, or "I don't know") + optional supporting upload (recent pay stub or last year's tax return)
6. Spending — guided question (monthly estimate, range, or "I don't know") + help text ("A rough guess is genuinely useful. We refine this together.")
7. What happens next card (completion)

Advisors can add, remove, reorder, and re-word items per client before sending. Edits after sending are allowed and versioned; the client page updates live on next load.

---

## 3. Advisor flow A — New client → compose → send

**Entry point #1 (locked):** the **New client** button. Creating a client and starting their intake is one motion, because in real life they are the same moment ("they said yes in the meeting").

```
New client
   │  name, email, phone (optional), household members (optional)
   ▼
Compose checklist
   │  template picker (New household default; firm can save its own)
   │  item list with add / remove / reorder / edit wording
   │  per-item: required toggle, help text
   ▼
Review + send
   │  link preview exactly as the client will see it (their name, firm brand)
   │  expiry shown plainly ("This link works for 30 days. You can extend or turn it off anytime.")
   │  [Copy link]  [Open email draft]  [Copy text for SMS]
   ▼
Client page opens with the Onboarding tab active, intake live
```

Design notes:

- **Sending is copy-first in v1.** The advisor sends the link from their own email or texting app. That keeps the client's email address off our server entirely (see ARCHITECTURE.md metadata honesty) and means the message comes from a human the client knows — which is the whole anti-drop-off point. "Open email draft" is a `mailto:` with a pre-written, editable message in the advisor's voice. In-app sending via the advisor's connected mailbox arrives with the nudge engine (Wave 2), same approval pattern.
- **The composer is a checklist editor, not a form builder.** No drag-and-drop canvas, no field grid, no conditional logic in v1. That restraint is deliberate (board stance: simple AI-first app, and JotForm already exists for generic forms). The unit is the *ask*, worded like a person.
- **Existing client?** The same composer is reachable from any client page (flow C). New client button is simply the fused create-and-start path.

Empty state for a brand-new firm: the New household template pre-loaded, one sample intake in preview mode so the advisor can experience the client side before ever sending one (this doubles as the demo).

---

## 4. Advisor flow B — the Onboarding board

**Rated VERY HIGH by the design partner; this is a first-class surface, not a report.** It lives as a top-level view in the client hub: every client with an active intake, at a glance.

```
Onboarding                                                    [New client]
──────────────────────────────────────────────────────────────────────────
Sarah Okafor          ████████░░  6 of 8    2 days ago     → next: nudge ready
  missing: license back, spending
Marcus & Lena Ruiz    ██░░░░░░░░  2 of 7    STALLED 9 days → nudge awaiting approval
  missing: SSN (Lena), income docs, license (both)
Priya Nair            ██████████  complete  today          → review 3 new items
──────────────────────────────────────────────────────────────────────────
```

Each row answers the four questions an advisor actually asks (from P5): *who's onboarding, what's still missing, how long have they been quiet, what should I do next.*

- **Sorted by "needs you"**: items awaiting advisor review first, then stalled clients (most-stalled first), then quietly-progressing ones.
- **Stall thresholds**: a client becomes "stalled" after N days of no activity (default 5, firm-configurable). Stalled rows get a warm amber accent, not alarm red — the tone is "give them a hand," not "delinquent."
- **The nudge queue** is embedded, not a separate screen: a stalled row shows the drafted follow-up inline. One click expands it, the advisor edits or approves, it sends from their own mailbox. (Full nudge design in section 8.)
- Clicking a row opens that client's Onboarding tab (flow C).
- **Board KPI strip (later wave, analytics):** average days-to-complete, current stalled count, completion rate. Deliberately absent from v1 — the board must first be a work surface, not a dashboard.

---

## 5. Advisor flow C — the per-client Onboarding tab

**Entry point #2 (locked): existing clients mid-process.** Every client page gets an **Onboarding** tab whenever an intake exists for them (active or completed). This is where an in-progress onboarding is resumed, managed, and finished.

The tab shows:

1. **The checklist, advisor view** — every item with its true state, provenance chips ("typed by client Jul 12", "from email reply, you confirmed Jul 14", "entered by you on call Jul 15"), and per-item actions: accept, request another look (with one plain sentence the client will see), mark not needed.
2. **Link controls** — the live link status (active, opens count, expires date), [Copy link again] [Extend] [Turn off link]. Turning off is instant and plainly worded: "The link stops working immediately. Anything already received stays."
3. **Received items** — each decrypted item as it landed: typed facts masked by default (SSN shows •••-••-1234; reveal is click-to-view and writes an audit row), documents as files already filed in the client's folder with a "view in folder" jump.
4. **"I don't know" flags** — soft cards: "Lena marked spending as unsure. Suggestion: the statement she uploaded may be enough to estimate it. [Run extraction]" (AI moment, section 9).
5. **Start phone walkthrough** — enters phone mode (section 8) for this checklist.
6. **Activity trail** — the intake's audit view in plain language: sent, opened, item provided, nudge sent, item accepted. Every AI action shows its receipt here.

When the last required item is accepted, the tab offers **Finish onboarding**: marks the intake complete, archives the link, and shows the "what fed the Client Map" summary — the demo moment: *8 facts and 5 documents now power this client's map.*

---

## 6. Client flow — the link experience

Mobile-first, firm-branded, light theme, no account, no app. The design target: **a 68-year-old on an iPhone finishes the core items in one sitting without calling the firm.**

```
Opens link (their name in the URL preview and on the page)
   ▼
Welcome card
   "Hi Sarah. Welcome to Journey Beyond Wealth. Dana asked us to
    collect a few things so your accounts can be set up. This takes
    about 10 minutes. You can stop anytime and pick up where you left off."
   [privacy line] "This page locks your information on your device.
    Only Journey Beyond Wealth can unlock it. Learn how →"
   ▼
One item at a time     ● ● ● ○ ○ ○ ○   (always-visible progress)
   ├─ typed field: big touch targets, inline format help, masking as they type
   ├─ upload: [Take a photo] first on mobile, [Choose a file] second;
   │          license shows a front/back framing guide
   ├─ guided question: number / range / "I don't know yet" as equal buttons
   └─ every item: [Save and continue] and a quiet [Skip for now]
   ▼
Done screen
   "That's everything for now. Here's what happens next."
   → firm-authored steps + timeline + who's-who (P7, expectation-setting)
   "Dana will be in touch within 2 business days."
```

Design decisions that carry the experience:

- **One item per screen.** The wall-of-fields is the portal failure mode (P1). Each screen is one ask, one sentence of why ("Schwab requires this to open your accounts"), one input.
- **"I don't know" is a first-class button, not a failure.** It advances progress, tells the advisor gently, and — where documents could answer it — offers "or upload something and we'll figure it out together." This is the direct answer to P4's second half (the info is genuinely hard to track down).
- **Save/resume is automatic and invisible.** Progress saves after every item (encrypted; see ARCHITECTURE.md). Reopening the same link on any device resumes at the next incomplete item. No password, no "session expired."
- **Write-only confirmation for secrets.** After submitting the SSN: "Provided ✓ (ending in 1234)". The full value is never displayed again on the client page, and cannot be — the page no longer has it (sealed to the firm). Same for license scans: after upload, a checkmark and the file name, no re-preview after the session ends. This is both the security story and a trust signal we say out loud on the privacy page.
- **The privacy line links to a one-screen plain-language explainer** (the client-facing sibling of the Data Map): what encrypts where, what the firm sees, what Lantern-the-company can never see. IT gatekeepers (G1) get the technical version; clients get this one.
- **Old or locked-down browser** (no WebCrypto, no JS): the page detects it and degrades honestly: "This browser can't open a secure page. Reply to Dana's email instead and she'll take care of it." — which is literally true, because the email-native fallback exists (section 7). No dead ends.
- **Completion is hospitality, not a receipt.** The what-happens-next page is firm-authored from a template (steps, rough timeline, photos/names of who they'll talk to). It converts the paperwork chase into the beginning of the relationship (P7).

Copy rules for everything client-facing: short sentences, no jargon, no em dashes, second person, the firm's name (never Lantern's) front and center. Lantern appears once, in the privacy explainer footer, as the technology provider.

---

## 7. Email-native fallback — the sleeper feature

For portal-haters and the non-technical (P6): the client just replies to the advisor's normal email with attachments and answers in prose. Lantern ingests the reply through the already-connected mailbox, proposes matches against the same checklist, and the advisor confirms. Same checklist, two doors.

**Pipeline:**

```
Client replies by email
   ▼
Ingestion (existing email connector, advisor's mailbox)
   ▼
Candidate matching (local/BYOK AI + rules)
   │  which client? which intake? which items?
   ▼
Proposal card on the advisor's board          ← NEVER silently filed
   "From Sarah Okafor's reply, 20 min ago:
    • IMG_2041.jpg → looks like: Driver's license (front)   [confidence: high]
    • IMG_2042.jpg → looks like: Driver's license (back)    [confidence: high]
    • 'my income is about 90k' → Income: $90,000            [confidence: medium]
    [Accept all] [Review each] [Not intake material]"
   ▼
On accept: items filed to the client's folder, checklist ticks,
           client fact written with provenance "email reply, advisor-confirmed",
           audit rows (intent/outcome pair) written
```

**Matching rules (deterministic gate before any AI):**

1. **Sender identity:** the reply's from-address must match the client's email on file for an active intake (or a household member's). No match → the email is never treated as intake material; nothing happens.
2. **Active intake exists** for that client. Completed/revoked intakes don't match.
3. Only then does classification run: attachment type detection + content classification against the *open* checklist items only (a license upload can't match an already-accepted license item; it becomes "possible update" instead, flagged separately).
4. **Confidence tiers:** high (auto-checked in the proposal, one-click accept), medium (pre-selected but shows its reasoning line), low (listed unchecked). Nothing is ever filed without the advisor's accept — the confirmation step is the product, not a speed bump, because a silently mis-filed SSN is the one mistake this feature can never make.

**Honest boundary, stated in the advisor UI and the firm's client-privacy explainer:** email replies are as private as the firm's email is — they do not get the end-to-end encryption of the link. The checklist item's provenance chip says "by email" so the firm always knows which channel each item used. We never pretend both doors have the same lock; advisors whose firm uses secure email (like Bracket, per the field research) keep that benefit.

**Extracted answers become the same client facts** — one data layer regardless of door.

---

## 8. Phone-walkthrough mode + nudges

### Phone mode (P6)

From the client's Onboarding tab: **Start phone walkthrough**. The advisor gets the client page's own flow, rendered inside Lantern, one item at a time, with two differences: every entry is chipped "entered by [advisor] on a call, [date]" (provenance is the compliance story), and the advisor can skip freely without the client-side gentleness. Items land identically: same facts, same folder, same checklist. One source of truth regardless of path.

Small but important: phone mode and the link can interleave. Grandma does the license photos with her daughter on Saturday via the link; the advisor fills income on Monday's call. The checklist doesn't care.

### Nudges (P5 — the awkwardness, delegated to software)

- **Trigger:** stall threshold reached (default 5 quiet days), or a specific item bounced ("needs another look" unanswered).
- **Draft:** AI writes a short, warm follow-up in the advisor's voice (learned from the advisor's own sent mail through the existing connector), referencing exactly what's missing and never more: *"Hi Sarah, hope the week's going well. Two small things left on your list: the back of your license and a rough monthly spending number. A guess is fine on the spending. Same link as before: [link]"*
- **Approval:** the draft appears in the board's nudge queue. The advisor edits or approves; it sends from the advisor's own mailbox. Never auto-sent. Cadence guard: never more than one nudge per client per N days (default 4), hard-capped at 3 unanswered nudges before the board suggests a phone call instead — software should escalate to humanity, not nag harder.
- **Receipts:** every sent nudge writes an audit row and shows in the activity trail. Every draft shows what it was based on ("missing items as of Jul 14, 9:02am").

---

## 9. AI moments — where "simple AI-first app" shows up

All three follow house rules: propose-then-approve, receipts, intent/outcome audit pairs (reuse the 2026-07-09 CRM write-engine machinery).

### 9a. Document Detective

The instant "you uploaded the wrong thing" catch, designed honestly around where AI can actually run (the client's browser has no AI keys; see ARCHITECTURE.md §7):

- **Tier 1 — instant, in the client's browser:** lightweight local classification (text extracted client-side, keyword/pattern rules — no network call, the document never leaves the device unencrypted). Catches the big misses immediately: *"This looks like your IRA statement. Great, but this item asks for your brokerage account. It usually comes as a statement like this one from [custodian]. Want to upload it here, or keep this one anyway?"* Wrong-side license detection ("this looks like the front again") works the same way.
- **Tier 2 — deep pass, on the advisor's machine:** after sync + decryption, the advisor's own AI (BYOK) verifies classification, reads the document properly, and proposes: checklist match confirmation, extracted facts, and "still missing" intelligence that feeds the next nudge draft.
- Tier 1 never blocks a determined client ("keep this one anyway" always works). Tier 2 never files anything without approval.

### 9b. Income & spending extraction

When a client says "I don't know" but uploads a tax return, pay stub, or statement — or when documents arrive by email — the advisor's machine proposes extracted figures: *"From the 2025 return: total income $91,400. Use as the income answer?"* Accepted values become client facts with provenance pointing at the exact source document and page. This shrinks P4's "the information is genuinely hard to track down" without bank-scraping scope creep.

### 9c. Nudge drafting

Covered in §8 — listed here because it is the third AI surface and follows the same rules.

### The Client Map moment

Every accepted item and fact feeds the client's map immediately. The intake tab and the demo both surface this: a small live "map growing" panel — day zero: a name; day three: DOB, income band, two accounts spotted in the uploaded statement; day seven: the household graph taking shape. **This is the demo's money shot** and the reason Intake belongs to Lantern's identity rather than to a forms tool.

---

## 10. Edge cases and empty states (design-complete list)

| Case | Behavior |
|---|---|
| Link opened on two devices | Both work; per-item last-write-wins; advisor sees both provenance rows. No lockout — the failure mode we refuse is a locked-out client. |
| Link forwarded / leaked | Holder can see progress labels and submit items; can NOT read any provided secret (write-only design). Advisor can kill the link in one click; ARCHITECTURE.md §6 covers rotation. |
| Client stops mid-upload | Chunked upload resumes on next visit; item shows "upload didn't finish" on reopen, one tap to resume. |
| Advisor offline for days | Client experience unaffected (items queue encrypted on the relay). Board catches up on next launch; nothing is lost. |
| Expired link opened | Friendly page: "This link has expired. [Firm] can send you a fresh one." + the advisor sees "client tried an expired link" on the board (that's a hot lead signal, not an error). |
| Revoked link opened | Neutral "this link is no longer active" page; no firm data shown, no client name (the revoked page must leak nothing). |
| Client uploads a 40MB scan PDF | Chunked, resumable, progress bar; size cap 100MB/file with a plain message above it. |
| Item edited by advisor after client answered | Answer preserved with "asked differently now" flag; client sees the item re-open only if the advisor explicitly requests another look. |
| Household with two people's SSNs | Items are per-person within one checklist ("Lena's Social Security number"); facts attach to the right household member. |
| No email on file, SMS-only client | Copy-link path covers it (advisor texts it); nudges fall back to a "call them" board suggestion in v1 (no SMS sending in v1). |
| Firm has no logo/brand set | Neutral light theme with the firm's name in text; setup nags the advisor once, softly. |

---

## 11. Where this lives in today's UI (code-grounded, verified in ~/lp-ux-integrate)

- **New client** exists: `NewClientDialog.tsx` in `src/features/matters/` (opened from `MattersHome.tsx`); client creation already derives the one-folder-per-client workspace layout (`matterManagerDialogHelpers.ts:53,73` — `clientFolderSegment`, `deriveNewClientFolderPath`). Intake compose extends this dialog's flow.
- **The client hub** is `MatterHub.tsx` with sub-tabs `HUB_TABS` (line 93): Overview, Documents, Email, Meetings. The **Onboarding tab** is a new `HUB_TABS` entry, shown whenever the client has an intake; the **Onboarding board** is a new view alongside the client list in `MattersHome.tsx`.
- **The Client Map** is `ClientMapPanel.tsx` — a sectioned facts view (core sections household / goals / money / followups, `src/platform/clientMap/types.ts:18`) where every item carries `sources: SourceRef[]`. Intake facts land as map items with intake provenance — the "map growing from day zero" moment uses the existing panel, no new visualization.
- **The approval-card pattern** for email-fallback proposals reuses the shape of `CrmWriteReviewCard.tsx` (mounted on the hub Overview) — advisors already know this interaction from CRM writes.
- **Nudge sending** reuses the mail rails advisors already connected (`src/features/email/`, `mail_save_draft` / compose machinery in `ComposeModal.tsx` + `followUpDraft.ts` — a follow-up-draft precedent already exists).
- **Nothing resembling client intake exists today** (`src/features/onboarding/` is app first-run setup, not client onboarding; Jotform is the insecure-forms connector we replace for sensitive asks) — the client page and relay endpoints are honestly net-new, detailed in ARCHITECTURE.md.

## 12. What v1 deliberately is not

- Not a general form builder (no conditional logic, no arbitrary field grid, no public templates gallery).
- Not e-signature (DocuSign bundling arrives with the paperwork stage; see WAVE-PLAN.md composition with the Schwab-prefill and Calendly tracks).
- Not a client portal (no login, no performance dashboards, no document browsing for clients — one checklist, then done).
- Not SMS-sending, not physical-mail mode, not the voice agent (grab-bag items 5 and 6 stay parked).
- Not multi-firm white-label domains (firm branding on our intake domain first; custom domains are a later conversation).

Each "not" keeps the board stance intact: one simple flow, AI-first, never an integration-breadth arms race.
