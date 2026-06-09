# Usability Test Protocol: Moderated, Think-Aloud (Session 2, ~60 min)

**Study:** Keepance v2.5.1, attorney segment
**Moderator:** Dr. Lena Whitfield
**Method:** Moderated, task-based, concurrent think-aloud, screen-shared and recorded. Participant drives; moderator observes and prompts minimally.
**Environment (Pass B):** Live signed v2.5.1 build on the participant's own computer, fresh install, clean test license, a provided test AI API key available if needed, and a **test email account preloaded with realistic but non-confidential messages** (never the participant's real client mail during a recorded session). Participant uses the bundled legal sample workspace.

---

## Pre-test setup and framing (0:00-0:05)

- Re-confirm consent and recording. Confirm screen share shows the whole app window.
- **Think-aloud instruction:** "The most important thing today: keep talking. Tell me what you're looking at, what you're trying to do, what you expect to happen, and when something surprises or annoys you. Narrate even when it feels unnatural."
- **Set expectations:** "We are testing the software, not you. There are no wrong moves. If you get stuck, that is the most valuable thing that can happen, because it shows us a problem. I won't help right away, because I need to see what you'd do on your own. If you would give up at some point in real life, tell me, that's a finding too."
- Capture a baseline: "How are you feeling about this so far, one to seven, seven is fully confident?"

---

## Moderator discipline (read before every session)
- Do not rescue on the first sign of struggle. Wait. Then: "What are you thinking?" Then: "What would you do next if I weren't here?"
- Only provide an assist after a genuine, sustained stall, and **record it as an assist** (it converts a task from unassisted to assisted success, or marks failure).
- Never use product vocabulary the UI doesn't show her first. If she invents her own word for something, use her word.
- After each task: capture the Single Ease Question (SEQ) and a one-line "what just happened."

---

## Task 1: First run: get from install to a working workspace (target 8-10 min)

**Scenario (read aloud):** "You just downloaded and installed Keepance because a colleague mentioned it. You're a litigator. Go ahead and get yourself set up the way you'd want it for real, and talk me through what you see. Get to the point where you feel you could start working."

**What this tests:** Onboarding wizard, profession picker (Legal), workspace = folder concept, **the API key step (documented #1 drop-off)**, and whether "local-first / your keys stay on your machine" is understood.

**Happy path:** Welcome → choose **Legal practice** → pick/create a workspace folder → API key step (understands what it is, follows the deep link, pastes a key, uses the **test key** button, sees success) → optional sample workflow → "populate sample files" → lands in workspace with legal samples present.

**Success criteria:**
- *Success (unassisted):* reaches a working workspace; either sets up a valid key with the test button or makes a conscious, informed choice to skip ("I'll do this later").
- *Partial:* reaches workspace but is confused about the API key, skips it without understanding, or can't explain what a workspace is.
- *Fail:* abandons during setup, or believes she's set up but is not (e.g., thinks Keepance hosts her files, or thinks she's paying Keepance for AI).

**Observe / likely friction:**
- Does "API key" stop her cold? Does the plain-English explainer and the "test this key" button rescue her, or not?
- Does she grasp that she pays the AI provider directly, not Keepance?
- Does "workspace" read as "a folder I control" or as something abstract/cloud?
- Comprehension check (after, not during): "In your own words, where are your files now, and who can see them?"

**SEQ + note.**

---

## Task 2: Produce a real deliverable: run a legal workflow and get it into Word (target 10-12 min)

**Scenario:** "A new client just came in. You want to turn your intake notes into a clean intake summary, and ultimately you need it as a Word document on your letterhead. Use Keepance to do that, and talk me through it."

**What this tests:** Workflows (Legal pack: Client Intake Synthesizer or Case Timeline Builder), the interview-form model, AI generation, the verification framing on research templates, and the **Markdown-to-Word concern** (does the output meet her "it has to look like a real document" bar, and can she find the export?).

**Happy path:** Workflows tab → pick a legal template → answer the interview questions → AI generates a draft document → reviews it → finds and uses export to Word (.docx) → opens it, confirms it looks like a real document.

**Success criteria:**
- *Success:* completes the workflow, produces a draft she judges usable as a first draft, and successfully exports to a Word document she'd be willing to put on letterhead.
- *Partial:* completes the workflow but cannot find export, or is put off by the Markdown/rendered view, or distrusts the output without the verification framing.
- *Fail:* cannot complete the workflow, or concludes "the output isn't a usable professional document."

**Observe / likely friction:**
- Reaction to the raw vs rendered document view. Does she see a "document" or "code"?
- Can she find the Word/PDF export? (Audit flagged export exists but may be under-surfaced.)
- Does she trust the AI output? Does she notice/appreciate the "verify citations before relying" framing on research templates?
- Does she try to edit the draft? Does the editor feel like a writing tool or a developer tool?

**SEQ + note.**

---

## Task 3: Connect email and understand what just happened (target 10-12 min)

**Scenario:** "The reason your colleague raved about this is the email feature. You're on Microsoft 365. Connect your email so you can search it later. As you go, tell me what you think is happening to your email."

*(Pass B: use the provided test M365 account. Never real client mail on a recorded call.)*

**What this tests:** The Integrations/email connect flow (device-code sign-in), folder selection / bounded import, the sync/progress experience, and most importantly **whether she correctly understands the privacy model**: mail is pulled to her machine, encrypted at rest, never sent to Keepance.

**Happy path:** Settings → Integrations → Microsoft 365 → "Sign in with Microsoft" → device-code flow in browser → consent → pick folders / scope → sync runs with progress → completes.

**Success criteria:**
- *Success:* completes the connection and sync, and can correctly articulate that her mail is now stored encrypted on her own machine and not on Keepance's servers.
- *Partial:* connects successfully but cannot explain where the mail went or whether it's safe ("I think it's on the cloud? I'm not sure").
- *Fail:* cannot complete the connection, abandons over a trust concern, or believes her mail was uploaded to Keepance/the AI.

**Observe / likely friction:**
- Does the device-code flow (a code, a browser, "expires in 15 minutes") confuse or reassure her?
- Folder selection: does she understand she can scope it? Does unbounded import worry her?
- The encryption story: is there a visible, plain-English signal that her mail is encrypted and local? Does she notice the full-disk-encryption nudge if shown?
- Comprehension check (after): "Walk me through what happened to your email. Where is it? Could Keepance read it? Could the AI?"

**SEQ + note.**

---

## Task 4: The payoff: find what a client said (target 8-10 min)

**Scenario:** "Now the part that matters. A client is on the phone asking what you agreed to about a deadline back in the spring. Using your email in Keepance, find the answer. Do it however feels natural."

**What this tests:** The wedge moment. Full-text mail search and/or asking the AI a natural-language question and getting the **actual email back with a citation**. This is the make-or-break "finally, I can find my email" experience.

**Happy path:** Either Search (mail results surfaced and marked as mail) or the AI chat ("what did [client] say about the deadline?") returns the specific message with a citation she can open and verify.

**Success criteria:**
- *Success:* locates the correct email and the specific answer, via search or AI, and can verify it against the source. Bonus signal: an audible "oh wow / finally" moment.
- *Partial:* finds something relevant but not the precise answer, or finds it but doesn't trust it without manual verification, or struggles to choose between Search and AI.
- *Fail:* cannot locate the answer, or the AI answers without a verifiable citation and she (correctly, as a lawyer) won't trust it.

**Observe / likely friction:**
- Search vs AI: which does she reach for? Is the choice clear?
- Does the AI answer include a citation she can open? (Lawyers will not trust an uncited answer. This is critical.)
- Does the result feel obviously better than Outlook search? Capture the comparison in her words.
- Emotional read: is this the moment the product "clicks"?

**SEQ + note.**

---

## Task 5: Trust and proof: would you bet a real matter on this? (target 8-10 min)

**Scenario:** "Last thing. Imagine this is now part of your practice. Show me how you'd check what the AI has been doing, and what it's costing you. Then tell me, honestly, whether you'd trust this with a live client matter, and what would have to be true for you to do that."

**What this tests:** Trust signals (the Audit log, cost tracking), comprehension of the overall data model, and the real adoption blockers.

**Happy path:** Finds the Audit log (sidebar → AI → Audit), understands it as a record of AI actions; finds cost tracking (per-chat/day chip, settings cost view); articulates the data model; states adoption conditions.

**Success criteria:**
- *Success:* locates audit + cost, interprets them correctly, and gives a clear, reasoned verdict on real-matter adoption with specific conditions.
- *Partial:* finds some signals but misreads them (e.g., audit feels invasive rather than protective), or gives a vague verdict.
- *Fail:* cannot find trust/cost signals, or concludes she would not trust it and cannot say what would change that.

**Observe / likely friction:**
- Audit log: protective ("I can prove what happened") or surveillance ("this watches me")? Framing-dependent; capture her read.
- Cost tracking: does BYOK + per-token cost reassure (honesty) or worry (unpredictable bill)?
- The adoption verdict and its conditions are a primary strategic finding. Probe hard but neutrally.

**SEQ + note.**

---

## Post-test (0:55-1:00)

- **SUS (System Usability Scale), 10 items, 1-5 each** (Strongly disagree to Strongly agree):
  1. I think I would like to use this frequently.
  2. I found the system unnecessarily complex.
  3. I thought the system was easy to use.
  4. I think I would need support from a technical person to use this.
  5. I found the various functions well integrated.
  6. I thought there was too much inconsistency.
  7. I imagine most people would learn this very quickly.
  8. I found the system very cumbersome to use.
  9. I felt very confident using the system.
  10. I needed to learn a lot before I could get going.
  *(Score 0-100 per standard SUS formula. Report band, not just number.)*
- Top 3 things that worked. Top 3 that frustrated.
- "If a colleague asked you tomorrow, what would you tell them this is and whether to try it?"
- "What's the one thing that, if we fixed it, would most change your answer about using it for real?"
- Thank, honorarium, close.

---

## Coding and metrics (for analysis)

**Task success coding:** Success (unassisted) / Success (assisted) / Partial / Fail. Record assists and where.

**Time-on-task:** Record observed band per task (fast / expected / slow / abandoned). Pass A reports qualitative bands only.

**SEQ:** 1-7 single ease rating per task, captured immediately after each.

**Severity scale (per usability finding), Nielsen-style:**
- **0**: Not a usability problem.
- **1**: Cosmetic; fix if time permits.
- **2**: Minor; low priority.
- **3**: Major; high priority, impedes task completion or trust.
- **4**: Catastrophe; blocks the user or causes wrong beliefs about safety/data. *(For this product, a wrong belief about where data goes is automatically a 4: it is both a usability and a liability problem.)*

**Capability vs communication label:** For every finding, mark whether the gap is a missing capability (build it) or a missing/poor communication of an existing capability (surface or explain it). The fixes are completely different.

---

## Addendum (2026-06-08): checks added after deep-research integration

Fold these observations into the existing tasks; they cover dimensions that S3 and S4 surfaced and that the original five tasks did not fully capture.

**During Task 1 and Task 4 (anywhere a prompt is sent):**
- Egress comprehension: when she sends a prompt, is there any visible signal of where it goes (local model, or which AI provider)? Does she notice it? Ask afterward: "When you just asked that, where did your question go, and who could read it?" Record whether she can answer correctly. (Tests the egress-indicator need from S4.)

**During Task 3 (connect email) and Task 1 (workspace setup):**
- Storage-at-rest comprehension: ask "are the files and email on your disk locked or readable if someone got your laptop?" Record her belief versus reality. (Tests the plaintext-at-rest and encryption findings, S3/S4.)
- Synced-folder awareness: if she chose, or would choose, a Dropbox/iCloud/OneDrive folder as her workspace, does she realize that re-introduces a third-party copy? Is there any warning? (S4.)
- Provider training: does anything tell her she may need to opt out of training in her AI provider's console? (S3.)

**During Task 5 (trust and verdict):**
- E-discovery / work-product: ask "every AI chat is saved as a file here. If this matter were in discovery, how do you feel about that?" Look for whether she wants to tag, segregate, or scrub. (S3, the single-strong-source finding most needing real-attorney confirmation.)
- Firm adoption: beyond "would you use it," ask "would you put this in front of your firm or a risk committee, and what would they demand?" (Informs the customer-definition fork. Capture the assurance items they name: SOC 2, DPA, SLA, support.)
- Evidence-grade expectation: for a contested matter, would the audit log and version history be enough to defend how a document was produced, or would she need something stronger (hashes, sealed records)? (S3/S4.)

**Add to the post-test wrap:** "If we could only fix one thing before you would trust this with a real client, what is it?" and "Is this a tool for you, or a tool for your firm? What is the difference for you?"
