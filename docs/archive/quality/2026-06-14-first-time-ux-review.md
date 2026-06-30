# Advisor Prep Hero — First-Time-User UX Review (2026-06-14)

> A review of the reimagined shell from the perspective of a brand-new solo litigator,
> oriented to the three things that matter: ease of use, adoption, and unique value.
> Reviewed against the live dev server + the real code. Two bug claims validated as real.

## The one-sentence takeaway

**The bones are extraordinary; the first fifteen minutes and the words are not yet.**
The gap between "good" and "can't-live-without" is almost entirely *sequencing and language*,
not capability. That is the best kind of problem: cheap to fix, high leverage. The hard
engineering is done and it is genuinely excellent.

## How it was reviewed

- Walked the real running app as a new solo litigator: onboarding → first landing → every tab → the core jobs (ask, find an email, browse docs, run a workflow).
- Four reviewers, four lenses: the "getting in" experience, the "using it" experience, the language/concepts, and the strategic value/adoption view.
- Every "this is broken" claim was checked against the source so we are not chasing false positives.

---

## Part 1 — The thousand-foot view

### 1. The aha moment never happens in the first session, and it should happen in two minutes
The magic is: ask a plain question, get a cited answer over your own confidential files. But a new user finishes setup and lands in an empty workspace with an empty Ask box. To feel the magic they must first get an AI key, connect email, import documents, and wait for indexing. We sell cited recall, then ask for twenty minutes of chores before they can taste it. **Everything to fix this already exists** — there is a fully written sample matter ("Garcia v. Meridian Properties") in the codebase. It is just not indexed and put in front of the user on day one.

### 2. The biggest adoption killer is the AI-key wall, and it is in the wrong place
A non-technical attorney has no idea what an "AI provider account" or "API key" is. Onboarding asks them to leave the app, create an account at a company they have never heard of, add billing, copy a string that is "shown only once," and paste it back — all before they have seen anything useful. Most will defer it, hit the empty Ask box, and not return. The key step belongs *after* the value moment, framed as an upgrade, not a toll gate.

### 3. "Matter" should be the spine, but it is just one of six tabs
The intended model is beautiful: everything organizes around a matter; Ask, Documents, Email, and the Associate are views on a matter. But the nav presents six equal siblings, so the unifying idea never lands. A first-timer on Ask does not realize it answers from their matters; on Documents does not realize that adding files is what makes Ask useful.

### 4. The unique value is real but mostly invisible
The privacy story is the best in legal software — the always-on "On your machine. Nothing leaves" indicator and the printable Data Map are true differentiators, well placed. But the other differentiators are hidden: you do not learn it is Word-native until you open a file; you cannot feel matter isolation until you have several matters; the cryptographic privilege protection is a tiny status-bar line.

---

## Part 2 — The first-run funnel (where people drop off)

1. **The AI-key step is the wall.** Make "Set this up later" the obvious primary action, not the third gray card. Add a real cost anchor ("most attorneys spend $2-5/month"). Cut the scary "copy it IMMEDIATELY, shown ONCE" framing. Defer the "turn off training" step out of onboarding.
2. **The "Your firm" step greets solos with "Invite firm members."** ~80% of the ICP is solo; this headline makes them feel they bought the wrong product. Flip it: "I practice alone, skip this" is the big top button; firm sign-in is the secondary option.
3. **The "Done" step offers two next actions with no hierarchy** ("start with a matter or open a document to try the AI") — and "try the AI" is false if they skipped the key. Give it one clear action: "Create your first matter." Default the sample-files toggle thoughtfully (fake client files appearing by surprise is alarming).
4. **The cold landing.** After onboarding the empty Matters state says "scope AI retrieval to their work only" — jargon. Speak plainly: "Keep a client's documents and emails together." And the trial pressure ("26 days left · Upgrade") on the very first screen is the wrong moment.
5. **Settings has 20 categories and the Setup Checklist is buried under "Onboarding."** A new user sent to connect email will not know to look under "Integrations." Put a 3-step setup card (AI / Email / Done) at the top of the first screen they land on.
6. **The "Where your data goes" step is a 10-row accordion** — a compliance data-dump at the wrong moment. Summarize in three bullets with a "read the full data map" link.

**The single biggest thing between "installed" and "first wow": the AI key.** Accept that most will defer it on day one. Let them in, give them an instant cited answer on sample data, then invite the key as the upgrade.

---

## Part 3 — The language problem (bigger than it sounds)

For a non-technical attorney, the words are the product. Several will cause a stumble or a misread.

### Navigation names
| Current | Problem | Suggested |
|---|---|---|
| **Associate** | Reads as a person (a junior lawyer), not a feature. They click expecting team management. | **Workflows** |
| **Ask** | Ask what? Ask who? The web? My files? The law? | **Search** (or "Ask my files") |
| **AI Audit** | Misreads as auditing the AI for quality, or an IRS-style exam. It is actually an activity log. | **Activity Log** |
| Matters / Documents / Email | Clear and correct | keep |

### The three confidentiality modes are too many and too jargony
"Local-only / Direct (your key) / Assured" asks a lawyer to hold three trust states built on concepts they have never met (API keys, proxies, zero-retention, BYOK). A lawyer does not think "what mode am I in" — they think "will my client's information leave my computer?" Collapse the user-visible story to **two plain states**:
- **"On your machine. Nothing leaves."** (keep this exactly — it is perfect)
- **"Sent to your [Anthropic] account."** (drop "Direct," drop "your key")

Fold "Assured" into a firm-tier setting; it only confuses solos when it shows greyed-out as "Needs admin key."

### Jargon to purge from user-facing copy
- **"egress"** → "AI request" / "sent to AI"
- **"API key"** → "account key" (onboarding already does this well; Settings still says "API Keys" — make them match)
- **"workspace"** (when it means the folder) → "folder"
- **"tokens" / "context is full" / "compress"** → "this conversation is getting long" / "shorten history and send" (and reassure: nothing is deleted from your files)
- **"Privileged matter"** used to mean a security lockdown collides with attorney-client *privilege* → call the security mode "Network lockdown / Isolated"
- Stray developer terms seen in copy: "Markdown," "embedding vectors," "MCP write blocked," "RAG"

A plain-English north star for "what is this and where does my data go":
> Advisor Prep Hero is a private file and AI tool that runs on your computer. Your client files stay in a folder on your hard drive; nothing is uploaded to our servers. Ask it a question and it searches your own files and answers with citations you can check. For AI help, you connect your own account with a company like Anthropic; your questions go straight from your computer to them, and Advisor Prep Hero is never in between. For work that must never leave your machine, you can run an AI locally. Every AI action is logged so you can prove exactly what happened.

---

## Part 4 — Consistency and simplification

- **Search works three different ways** across Ask (bottom prompt + chips), Email (Search/Ask toggle up top), and Documents (inline toolbar field). Same job, three grammars. Unify: the AI prompt is always at the bottom; keyword search is always a toolbar field that looks identical everywhere.
- **The primary action moves around:** top-right on Matters/Email, top-left on Documents, bottom on Ask, none on Associate. A first-timer relearns "where is the thing I do" on every tab.
- **Two status bars eat ~16% of a short screen.** The top trust bar and the bottom status bar (trial badge, file name, privilege badge, all-matters, bug report) overlap in purpose and are dense. Combine into one bottom strip with left/center/right zones.
- **Documents loses your place.** Opening a file replaces the browser and the only way back is a tiny "‹ Documents" text link. A persistent file list on the left (like Finder/VS Code) with the document on the right removes the back-and-forth entirely.
- **Email's "Ask AI" mode is a bare box** with a truncated placeholder and no examples — unlike the main Ask tab. Give it the same headline + 2-3 email-specific example prompts.
- **Combine the two "Ask" experiences.** The Ask tab and Email's "Ask AI" are the same pattern with a different scope. One "Ask anything" surface with a scope toggle (All matters / This matter / Email / Documents) is one place to go instead of two.

---

## Part 5 — Two real bugs (validated in code)

1. **"New matter" does nothing.** The headline button on the Matters home — the first call to action a new user sees — fires an internal "open the matter creator" signal that *nothing is listening for*. Clicking it has zero effect. Worst kind of first-impression bug. (Root: it dispatches `keepance:open-matter-manager`; there is no handler. Fix: wire the handler, or open the matter dialog inline.)
2. **Opening an email shows nothing.** On the Email tab, "Open" on a message opens it in the document pane — but that pane is not visible while the full-page Email surface is showing, so it looks dead. (Root: the full-screen redesign made every tab full-page, but the email-open path still assumes the old editor pane is on screen. Fix: switch to the editor view on open, or render the email inline on the Email surface. Small change.)

Both are quick fixes and fold into the first refinement round.

---

## Part 6 — What I would do, in priority order

1. **Deliver the aha moment in the first session.** Ship the sample matter ("Garcia v. Meridian") pre-indexed and instantly queryable, so a new user gets a cited answer before any setup. Move the AI-key ask to *after* that moment. *(Highest leverage; the pieces exist.)*
2. **Fix the two dead interactions** (New matter, Open email). Table stakes — a dead primary button poisons trust in everything else.
3. **Plain-language pass.** Rename Associate → Workflows and AI Audit → Activity Log; clarify Ask; collapse three confidentiality modes to two plain states; purge the jargon list.
4. **Repair the first-run funnel.** "Set up AI later" as the default; flip the Firm step for solos; one clear action on Done; surface the setup checklist on the landing.
5. **Unify the surfaces.** One search pattern, consistent primary-action placement, combine the two status bars, persistent Documents split.

Then the structural bet, when ready: **make "matter" the felt spine** — enter a matter and see its documents, email, and a matter-scoped Ask in one place, instead of six parallel tabs.

---

*Capability is not the gap. The first fifteen minutes and the words are. Both are fixable fast.*
