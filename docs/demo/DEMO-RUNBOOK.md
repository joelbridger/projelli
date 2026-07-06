# The Demo Script

**⚠️ DRAFT — this is the plan for the demo, but not every step has a final "yes, tested and works" checkmark yet. Before the real demo, ask for the latest test results and update this line.**

This is a step-by-step script for showing off the app live, in front of people. Follow it in order. Read the whole thing once before you do it live — especially the "if something goes sideways" page near the end.

Think of this like a stage play. You know your lines, you know what might go wrong, and you know what to say if it does.

---

## Before the demo: get-ready checklist

Do all of this **before** anyone is watching. None of it should happen live.

- [ ] **Use one demo workspace only, and set it up ahead of time.** Right now the app can only really work well with one client list at a time — think of it like one filing cabinet. If you try to switch to a different filing cabinet in the middle of the demo, the app gets confused about which clients belong where. So pick your demo workspace (your one filing cabinet) in advance and don't touch any others.
- [ ] **Make sure your example clients are already loaded in.** The app comes with a pretend example client set (three made-up families with a made-up financial advisor firm). Have this loaded in and sitting there before you start.
- [ ] **Clean up the client sidebar.** Old test clients from earlier rehearsals can stick around. Archive anything that isn't one of the three demo families — the sidebar now tidies itself up automatically once a client is archived, so you don't need to fight with it every time. Just double-check the sidebar shows only the three demo families before you start.
- [ ] **Make sure all the files are already "read" by the app.** The app needs a little time to read through documents and understand them, kind of like a person skimming a stack of papers before a meeting. Do that skimming ahead of time, so when you're live, the answers come back instantly instead of you sitting there waiting. This preloaded set is what you'll use for Step 4 (Ask) — keep it separate from the small, live import you'll trigger just for Step 3 (Progress Screen).
- [ ] **Delete any leftover test meeting recordings under the demo clients.** Earlier rehearsals can leave stub "Needs review" recordings sitting under a demo family's Meetings tab. Clear those out ahead of time so nobody accidentally clicks into an old test recording live.
- [ ] **Have the prepared Q&A sheet open and ready** (`docs/demo/DEMO-QA-CRIB.md` — the presenter's crib sheet of demo questions), so you're not hunting for it live.
- [ ] **Download the on-device AI brain ahead of time.** The app can answer questions two ways: using an AI that lives out on the internet (like ChatGPT), or using a smaller AI "brain" that lives right inside the app on the computer, so nothing ever has to leave the machine. That second one is a big file (about the size of half a movie) and takes a while to download. Get it downloaded the night before — never make people watch a download bar during the show.
- [ ] **Connect and check your ChatGPT key ahead of time.** The app needs a password-like key to talk to ChatGPT. Plug that in beforehand and use the app's own one-click "Check" button next to the key — no need to spend a real question on it, the button alone flips it to "✓ Working."
- [ ] **Fully restart the app once, then ask one warm-up question, before anyone arrives.** Computers (and this app) sometimes run a little slow or stiff the very first time they wake up. Restarting once and asking a throwaway question first is like stretching before a run — it wakes everything up so the real demo answers come back fast and smooth.
- [ ] **If a "welcome tour" pop-up shows up after the restart, dismiss it.** It shouldn't reappear once you've skipped it before, but check anyway — better a two-second dismiss in private than a pop-up interrupting you live.

If you skip this checklist, the risk is: long boring waits, a download bar nobody wants to watch, or clients that show up "missing" because the filing cabinet got switched mid-show.

---

## The 6 steps of the demo

### Step 1 — Connect AI

**What you're showing:** the app can think using two different "brains" — ChatGPT (out on the internet) and a Local AI (built into the app, works with zero internet).

**What to do:**
1. Click the gear icon to open Settings, then choose **AI & Privacy**.
2. Scroll down and click **"Manage AI Account Keys."** This opens a small window with a checkmark beside each AI provider — that's where the real "✓ Working" checkmark lives, not the main settings screen.
3. Point at the checkmark next to ChatGPT. It'll also say something like "checked 5 min ago" — that's just telling you when it was last confirmed, and you already did that confirming ahead of time in the get-ready checklist, so you don't need to click Check again live.
4. Show the Local AI card says "Installed and ready" — explain in one line: *"This one lives right on this computer. Nothing about your questions ever has to leave the machine when you use it."*

**What to say:** "The app can think two ways — one that reaches out to the internet, and one that stays completely private on your own computer. Both are ready to go."

---

### Step 2 — Connect Data

**What you're showing:** the app can pull in real client information from the tools advisors already use — Outlook (email), OneDrive (cloud file storage), and Wealthbox (their client-relationship software).

**What to do:**
1. Show the example connections already made. **Check on the day whether Outlook is actually connected** — if it isn't, don't fake it or skip past it awkwardly. Just show the two that are live instead.
2. Point out the client count only if it visibly changes while everyone's watching — during a live import, the number can climb within a few seconds as records come in. Don't quote specific numbers unless you're actually watching it happen live in front of people.

**What to say:** "You just point the app at the tools you already use, and it goes and gets your real client information — it doesn't make you retype anything." If Outlook isn't connected that day, say instead: *"Email is one of the connectors — here's OneDrive and Wealthbox live right now."*

---

### Step 3 — Progress Screen

**What you're showing:** while data is coming in, the app is honest and clear about what it's doing — it doesn't just sit there with a spinning wheel and no explanation.

**What to do:**
1. The demo machine has a folder of extra reference PDFs sitting ready and waiting — a stack of about 30 small filler documents (nothing about real clients, just general practice reference material). Either point the app at that folder, or, if it's already sitting there from setup, just restart the app — the restart alone makes it re-read the folder and the progress screen shows up on its own.
2. Point at the progress message on screen as it counts up — it'll look something like: *"Indexing PDFs: 17 of 36. Nothing leaves your machine."*
3. Call out that this message updates live as it works.

**What to say:** "Notice it tells you exactly what it's doing and how far along it is — like a loading bar with real words instead of just a spinner."

If this happens to finish instantly instead of showing the counting-up screen, that's fine too — fall back to "this one was quick" (see the sideways table) rather than waiting around for it.

---

### Step 4 — Ask

**What you're showing:** you can ask the app plain-English questions about a client, and it answers using the real documents, with both AI brains.

**What to do:**
1. Open the prepared Q&A sheet you already have ready, and pick one question about a family whose files are already fully read — from your preloaded set, not from anything still importing.
2. Ask it first with **ChatGPT** selected. Read the answer out loud, and point at the little citation/source note showing which document it came from.
3. To switch to **Local AI**: click the gear icon → **AI & Privacy** → tap the **"On this computer only"** card. You'll see a little lock message appear — that's the app turning on network lockdown for you. Call that out as a good thing: *"See that lock message? That's the app switching off its own internet connection so it can prove nothing leaves this machine."* Then go back to Ask.
4. Ask a **throwaway warm-up question first** (something short and simple, not one of your real crib questions), then ask your **real** short one-fact question for the same family. Keep it short — the Local AI brain has a much smaller "working memory" than ChatGPT (like the difference between a sticky note and a whiteboard), so long or multi-part questions can come back muddled. Stick to the pre-written short questions.
5. If an answer ever mentions that data is "still importing," don't wait it out live — switch straight to a different pre-written question about a family you know is already fully loaded, and move on.

**What to say:** "Ask it something in plain English, like you'd ask a colleague. Watch — it tells you exactly which document the answer came from, so you can always double check it."

---

### Step 5 — Record Meeting

**What you're showing:** the app can record a real Teams meeting, and it's upfront with everyone in that meeting that recording is happening.

**What to do:**
1. Start a Teams meeting and start the app's recording feature.
2. **A little while after you hit record — this can take up to about 2 minutes — a guest named "Recording Notice" will try to join the meeting, like anyone else knocking to get let into a call.** When you see that knock, **let it in.**
3. While you're waiting for the knock, just keep talking normally — don't stop the demo to stare at the screen.
4. Once it's in, point it out calmly: *"That's the app announcing itself to the meeting — it adds a visible participant so everyone can see the meeting is being recorded."*

**Important wording — say it this way, every time:** *"The app adds a visible recording-notice participant to the meeting."* **Do not say** "Teams shows everyone a recording banner" — that's not accurate to how it actually works, and we want to always describe it honestly.

**What to say:** "I just started recording, and in a moment you'll see the app knock to join the call and introduce itself, so nobody's left wondering if this is being recorded."

---

### Step 6 — Search Transcript

**What you're showing:** after the meeting, you can ask questions about what was actually said, the same simple way you asked about documents in Step 4.

**What to do:**
1. Give it a few seconds after the meeting ends — the transcript needs a short moment to finish saving and become searchable, kind of like waiting for a photo to finish printing before you look at it.
2. Go back to the same Ask box you used in Step 4.
3. Ask a plain-English question about something that was actually said during the recorded meeting (e.g. "What did we decide about the Roth conversion?").
4. Point out that the answer is pulled straight from the meeting transcript, with a source note.

**What to say:** "Same Ask box as before — except now it can also search everything that was said out loud in the meeting we just recorded."

---

## If something goes sideways

Calm, honest narration beats pretending nothing happened. Here's what to say and do at each step.

| Step | Likely hiccup | What to say / do |
|---|---|---|
| 1. Connect AI | ChatGPT or Local AI shows an error instead of "Working" | Say: *"Looks like this one needs a moment — let's use the other AI brain for now and come back to this."* Switch and continue; don't troubleshoot live. |
| 2. Connect Data | A connection is slow or shows an error | Say: *"This one's still catching up — let's look at a client we already have loaded."* Move to an already-connected example client. |
| 3. Progress Screen | Import looks stuck or finishes instantly (no visible progress) | Say: *"This one was quick — most of the heavy lifting already happened before today."* Move on; don't wait around for a bar to move. |
| 4. Ask | Answer looks thin, vague, or says it can't find anything | Say: *"That file might still be catching up — let's give it a second and ask again,"* then re-ask the same question once. If it's still thin, pick a different pre-written question from the crib sheet instead of improvising a new one. |
| 5. Record Meeting | The "Recording Notice" guest is slow to knock (up to ~2 minutes is normal) | Keep talking normally — don't go quiet and stare at the screen. When it appears, calmly let it in and narrate it, same as if it had shown up right away. |
| 5. Record Meeting | The notice guest never knocks at all | Say: *"We'll keep going and check the recording after the call."* Keep recording and move on; don't restart the meeting live. |
| 6. Search Transcript | Answer doesn't seem to include anything from the meeting | Say: *"Let's give the transcript a second to finish saving,"* wait briefly, then re-ask once. If still thin, fall back to a Step-4-style document question instead. |

**General rule for any hiccup, anywhere:** narrate calmly, don't apologize repeatedly, and have a backup question or client ready so you're never standing there in silence.
