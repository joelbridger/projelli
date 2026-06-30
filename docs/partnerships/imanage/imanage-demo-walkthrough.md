# iManage demo walkthrough (recorded partner call)

> A click-by-click script with a talk track you can run live. ~12-15 minutes of demo,
> then questions. The call is recorded and feeds iManage's approval, so the goal is:
> show a credible, polished, privacy-first product, and make the read-only connector
> feel obvious and low-risk for them.
>
> **Refresh the screenshots in the deck after the final UI polish pass before the call.**

---

## What iManage told us they want to see (from Sarah's email)
- A demo of the product and the **use cases** for the integration.
- An integration that **enhances iManage for mutual customers** while iManage stays the
  **secure, governed repository**.
- It is reviewed by their **Product team**, so speak to product value + a clean, safe technical shape.

## The one-line story
"iManage is where the firm's documents live and stay governed. Advisor Prep Hero sits beside it on
the lawyer's machine and answers questions across their matter, with a citation back to the
exact source. Version one only reads from iManage. Nothing is ever written back."

## Pre-call setup (do this 30 minutes before)
- [ ] Open Advisor Prep Hero on a clean workspace with the **sample matter** present (Garcia v. Meridian) plus, ideally, one realistic matter with a few real documents.
- [ ] Confirm the reimagined shell is showing (navy left rail: Matters / Search / Documents / Email / Workflows / Activity Log / Settings).
- [ ] Have an AI key connected so live answers work (have the no-key "aha" as a backup if the network is flaky).
- [ ] Close noisy apps, silence notifications, full-screen Advisor Prep Hero.
- [ ] Have the deck open in a second window to flip to the architecture slide.
- [ ] One sentence ready if anything breaks: "That's the dev build talking, let me show you the slide for this part."

---

## The demo, beat by beat

### 1. Frame it first (30 sec, before sharing the app)
> "Quick context: Advisor Prep Hero is a local-first desktop app, the private intelligence layer for a
> law practice. A firm's documents, email, and matters stay on their own machine, the AI runs
> on their own key, and every answer is cited so they can verify it. Today I'll show you the
> product, then exactly how I see it sitting on top of iManage."

### 2. Matters = the spine (1 min)
- Click **Matters**. Show the matter list.
- Talk track: "Everything is organized by matter. A matter is a wall: its documents, email, and
  AI all stay inside that boundary, so the wrong client's data never bleeds into the wrong answer."
- Click a matter to open its **hub**. Point at the at-a-glance and the panels (Documents, Email, Workflows).

### 3. The aha: a cited answer (3 min) ← the centerpiece
- In the hub's "Search this matter" box, type a real question, e.g. *"What's the fee arrangement?"*
- It lands on **Search** and answers, with a **[1]** citation chip.
- Click the citation: the source panel opens the exact document and passage.
- Talk track: "This is the whole product in one motion. It read the matter's own files, answered
  in plain language, and showed me the source. A lawyer can trust it because they can check it.
  No file left the machine to do this."

### 4. The trust story (3 min) ← this is what the Product team cares about
- Point at the **egress indicator** in the top trust bar ("On your machine. Nothing leaves." / or the provider it's going to).
- Click **"Where does my data go?" / Open the Data Map**. Walk the rows: files stay local, the
  key lives in the OS keychain, the cloud prompt goes directly to the provider on the firm's own
  account, local-only mode sends nothing.
- Talk track: "Advisor Prep Hero never holds the firm's data or their AI key. We are not a content server.
  For iManage this matters: we don't become a second copy of the repository or a new place data
  can leak. We read, we index locally, we answer."
- Show **matter isolation** (the Isolated badge / local-only) briefly.

### 5. Documents, Word-native (1 min)
- Open **Documents**. Show the file browser (tree + grid) over a real workspace.
- Talk track: "Real files on disk, Word-native. This is the same shape a firm's iManage documents
  would take once imported into a matter."

### 6. The integration vision (3 min) ← the actual ask
> Be honest: version one is read-only and not built yet. Storyboard it from the architecture slide.

- Flip to the **architecture slide** in the deck.
- Talk track: "Here's how I see it working, and I'd want your Product team's view on the cleanest shape:
  1. The lawyer connects their iManage account inside Advisor Prep Hero and browses their iManage workspaces and matters.
  2. They pick the documents or a workspace to bring into a matched Advisor Prep Hero matter.
  3. Advisor Prep Hero imports a copy and indexes it locally, so the firm's private AI can answer matter-scoped
     questions with citations.
  4. **Version one is read-only. Nothing is written back to iManage.** iManage stays the system of record
     and the governed repository. Advisor Prep Hero is the intelligence layer on top.
  - We'd build against your APIs the right way, honor your permissions model, and never store iManage
    credentials on a server, only in the user's OS keychain."
- Land it: "So the value to a mutual customer is: they keep everything governed in iManage, and they get
  a private, cited answer engine across it, without their data or their AI usage leaving their control."

### 7. Close (1 min)
> "That's the product and the integration I want to build with you. Reading the partner program,
> the next step on our side is the NDA, which I'm completing, and then getting access to the
> technical docs and a sandbox so we can scope version one properly. What does the Product team
> need from me to move this into the review?"

---

## Anticipated questions (have answers ready)
- **"Are you writing back to iManage?"** No. Version one is strictly read-only; iManage stays the source of truth. Write-back, if ever, is a later conversation with explicit governance.
- **"Where does the data go / is this another cloud copy?"** It stays on the user's machine. We're local-first; we are not a content server. The AI call goes from their machine to their own provider account, or through a zero-retention proxy for firms.
- **"How do you handle iManage permissions / ethical walls?"** We'd honor iManage's permission model on read, and our own matters are cryptographically isolated, so a walled-off user can't get a matter's key.
- **"How many customers / how far along are you?"** Be honest: pre-traction, building our first firm customers, not yet integrated with a DMS, which is why iManage is a priority. Frame it as: we want to build the connector right, with you, early.
- **"Pricing?"** Per-seat annual: Solo $468, Professional $948, Firm $1,548 per seat per year.

## What NOT to do
- Don't claim a built iManage integration. It's the vision; the local import is the working stand-in.
- Don't overclaim "fully encrypted" or "nothing ever leaves" without the honest asterisk (cloud AI goes to the provider on the firm's account). The product's own copy is now careful about this; match it.
- Don't demo a half-polished screen. If a surface isn't ready, use the slide.
