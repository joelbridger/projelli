# Keepance Testing — Evaluation & Improvement Plan

**For:** Jameson
**From:** your lead engineer
**Date:** 2026-06-24
**What this is:** a full, plain-language evaluation of how we test Keepance today, what's slowing us down, and exactly what to change — plus a straight answer on whether to buy Windows computers.

> You asked me to optimize for two things: **shipping faster**, and **stopping the same bugs from getting caught over and over**. Cost (AI usage) is not a concern. This report is built around those two goals. It draws on our own honest write-up of how we test, two outside research reports (ChatGPT and Gemini), the *actual* test scripts in our codebase, and an independent review by a second AI engineer (a different model) that I had argue against all of it.

---

## 1. The one-paragraph version

Our testing is in good shape — better than most teams. The problem isn't *what* we test, it's *where the work happens*. Right now the **slowest, most hands-on part of testing — driving the real app on a Windows laptop, by hand, one screen at a time — is doing two jobs at once**: it's both the *final* "is this truly working?" check **and** the place where we *first discover* most bugs. That one fact explains both of your pains. It's slow because everything funnels through a single laptop, one click at a time. And we keep re-finding the same bugs because nothing we find on that laptop gets turned into a permanent automatic test — so it can quietly come back. **The fix is not to test Windows less.** It's to make the fast, automatic checks the *first* line of defense, build one reliable "test robot" so the Windows check stops being a slow manual chore, and let the laptop go back to being only the *final* judge. We already own most of the parts — we just built them for other purposes and never wired them into the everyday loop.

**My clear call on hardware:** a second Windows machine is worth buying, but it barely helps until we build the test robot first. So the robot comes first (it's only a few days of work); the machine is a fast-follow, not the starting move. Don't chase the bigger hardware setup the Gemini report recommends — it fixes a problem we don't have.

---

## 2. How testing works today (in plain terms)

Think of testing as checking a car before a road trip. It has two layers.

**Layer A — the fast automatic checklist ("the gate").** Before any change is allowed in, a computer automatically runs thousands of tiny checks in a few minutes: does the code hold together, do the small pieces behave, did anything obvious break. We have a *lot* of this — thousands of small tests across ~489 files, plus checks on the Rust engine (Rust is the fast, low-level language our private "backend" is written in). This part is genuinely strong.

**Layer B — actually driving the car (the Windows laptop).** Here we open the *real, built app* on a real Windows laptop ("the Legion") and click through every screen like a customer would — import files, build a client profile, ask questions, check that one client's data never leaks into another's. This catches the bugs that *only* show up in the real thing: file pop-ups, the way pages draw, the live AI, real Windows file paths. This is our highest-value testing, and it's right that we do it.

The trouble is entirely about **how Layer B runs**:

- It happens on **one laptop**, reached over a remote connection, **one action at a time**. A single sweep of ~15 screens is dozens of slow back-and-forth round-trips.
- Every run usually **rebuilds the whole world first** — re-reading 374 demo files (most of them PDFs that need slow text-scanning) before we can even start checking the thing we changed.
- The AI screens call a **live AI model every time**, so the answers differ a little on every run. That makes it hard to tell "did my change break this?" from "did the AI just word it differently this time?"
- When something looks wrong, we **pull screenshots back and eyeball them by hand**.

None of that is broken. It's just slow and manual, and it's carrying more of the load than it should.

---

## 3. What we're already doing well (don't touch these)

This is a strong starting point, not a mess:

- **A real two-layer setup** — fast checklist underneath, real-Windows judge on top. Exactly right for this kind of app.
- **Clean slate before testing.** We learned the hard way that leftover data from old runs fakes you out (a client summary once looked like it had 128 duplicate facts; a truly clean run showed 35). We now wipe and start fresh.
- **Realistic fake data** — "Northcrest Wealth Partners," 374 files, 26 client households. Testing on lifelike data is how you find lifelike bugs.
- **"Prove the fix on Windows before calling it done."** We don't trust a fix until we've watched it work live. That discipline is rare and right.
- **Parallel fixing.** When we find a batch of bugs, we split them across several independent AI engineers (each in its own isolated copy of the code) so they fix in parallel without colliding.

The improvements below build *on* these. They don't replace them.

---

## 4. The two real problems, and the single root cause

You named the two pains exactly:

**Pain 1 — the waiting.** Caused by Layer B being slow and serial: one laptop, one click at a time, rebuild-the-world before every run.

**Pain 2 — catching the same bugs over and over.** Caused by two things: (a) bugs we find on the Windows laptop **don't become permanent automatic tests**, so nothing stops them sneaking back; and (b) the **live AI makes every run slightly different**, so we re-investigate "is this a real bug?" again and again.

Both pains share **one root cause**: *our slowest, most manual layer is also our first line of defense.* We discover problems in the most expensive possible place, and we don't push what we learn down into the cheap, automatic, permanent place.

Here's the mental model to move to — picture an **hourglass**:

- **Wide bottom** = lots of fast automatic tests (we have this).
- **Narrow middle** = a modest set of checks for the trickiest, app-specific behaviors (client isolation, indexing, AI-answer handling) that run automatically and *the same way every time*. **This is the layer we're thin on.**
- **Narrow top** = a *small* set of real-Windows checks plus hands-on exploring for "does this actually feel good?" judgment calls.

Today our hourglass is missing its middle, so everything heavy piles onto the top.

**And one insight that's specific to us — both outside reports missed it.** *Our testers are AI (me and Codex), not humans.* An AI tester isn't slowed down by machine speed nearly as much as by **vague, flaky results**. When a test fails in a fuzzy way, the AI wastes time "fixing" the wrong thing — which is *exactly* the "catching bugs over and over" feeling. So the most valuable thing we can build is not more horsepower; it's a setup that hands the AI **small, clear, trustworthy proof every single run.** The independent reviewer flagged this as the thing everyone else got wrong, and I agree.

---

## 5. The good news: we already own most of the parts

Before recommending we "build" things, I checked what already exists. A lot of what the outside reports told us to build, **we built already — just for other reasons**:

- **A "fake AI" that gives canned, realistic, streaming answers** already exists (`mock-ai.ts`). We use it to record marketing screenshots. It's exactly the "make the AI behave the same every time" tool both reports said to create — we just never pointed it at our test loop.
- **A real browser test suite of ~254 tests already exists** and can run against a production-like build. But — and this surprised me — **it does not currently block bad changes from getting in** (our automatic gate runs the small tests but not this browser suite), and it **never runs on Windows**.
- **Reset/seed scripts already exist** to lay down the demo and wipe state — they're just fiddly and not a single reliable "one button" reset.
- **Automatic evidence capture** (recordings, screenshots-on-failure) is **already configured for the browser suite** — just not for the Windows laptop driving.

So this is less "go build a pile of new machinery" and more "**connect and promote the machinery we already have.**" That makes this faster and lower-risk than the outside reports assume.

---

## 6. The plan — what to change, in priority order

### ⭐ The centerpiece: build one reliable "test robot" for the Windows app (do this first)

Today our Windows testing is a stack of separate scripts that we run by hand, one slow remote command at a time, re-stitched together every session. The single highest-value move — and the independent reviewer's #1 pick too — is to package what we already have into **one always-on "test robot" that lives on the laptop** and takes simple, high-level orders:

- **"Reset to the clean demo world"** — one button, reliable. (This is trickier than it sounds: a true reset has to wipe several hidden leftovers — old AI summaries, the search index, the recent-folders list, the activity log — not just the obvious storage. The robot gets this right once, so we never fight it again.)
- **"Walk every screen and screenshot it."**
- **"Ask this question and tell me whether the answer was properly cited."**
- **"Check that no client's data leaked into another's."**
- **"Hand back an evidence bundle"** — screenshots, logs, exactly what it clicked, and for AI screens the exact sources the AI used.

Because the robot stays connected and hands back a clean **pass/fail packet**, it kills the slow per-click round-trips *and* the fiddly reset *and* the manual screenshot-eyeballing in one move. And it's the natural home for the "fake AI" (below), so the AI screens stop varying run to run. **Most of these parts already exist as separate scripts — this is mostly packaging them into one dependable service.** Effort: medium, a few focused days. Impact: hits *both* your pains at once, and makes every later improvement easier.

### Then — the cheap "trust" fixes (attack the recurring-bugs pain)

**A. The "catch it once" rule.** Make it a hard rule: *every bug we find on the Windows laptop becomes a permanent automatic test the same day, before we call it fixed.* This is mostly discipline. It's the single thing that ends the "catching bugs over and over" cycle — once a bug is guarded by an automatic test, it can't quietly come back. **Effort: small. Impact: directly fixes Pain 2.**

**B. Point the existing "fake AI" at the test loop.** Record the AI's real answers *once* into saved files, then replay them on demand (this becomes the robot's "ask a question" mode). Now the AI screens behave the *same way every run*, so a failure means a real bug — not the AI rephrasing itself. We already built the hard part. **Effort: small-to-medium. Impact: kills a whole class of phantom bugs.**

**C. Make the ~254 browser tests actually guard the door.** Wire the existing browser suite into the automatic gate (using the fake-AI mode so it's fast and stable), so a change that breaks a screen is caught *before* it ever reaches the Windows laptop. Run these on rented cloud machines — you're fine spending on compute. **Effort: medium. Impact: moves most bug-catching out of the slow lane.**

### Then — speed & scale (attack the waiting)

**D. Clone a ready-made world instead of rebuilding it.** Keep a pre-built copy of the demo workspace with its file index *already built*, and drop it in at the start of a test instead of re-reading 374 files every time. We only do the slow full rebuild for the few tests whose whole point is to check importing/indexing. **Effort: medium. Impact: cuts the "rebuild the world first" tax off the top of nearly every run.**

**E. An automatic Windows "smoke test" that runs unattended on rented cloud Windows.** Once the robot exists, a small reliable set of real-Windows checks (with the fake AI + the pre-built world) can run *by itself* on every meaningful change — on rented cloud Windows machines you spin up and shut off. Because the data is fake (Northcrest), there's no privacy issue with the cloud. This is what finally turns the Windows check from "a person drives it, slowly" into "it runs itself, in parallel, while we do other things." **Effort: medium-to-large. Impact: the biggest sustained hit to Pain 1.**

### Then — keep it honest (hygiene)

**F. Treat flaky tests as their own bug list.** A test that fails randomly erodes trust in *all* the tests (and, for an AI tester, sends it chasing ghosts). Track them, quarantine the noisy ones, assign a fix — don't let them linger in the critical path. **Effort: small, ongoing.**

---

## 7. The hardware question — my clear answer

**Short version: a second Windows machine is worth buying, but it barely helps until the test robot exists. So build the robot first (a few days), then the machine pays off. Do not chase the bigger compile-sharing hardware setup the Gemini report recommends.**

The detail:

- **A second machine, on its own, helps surprisingly little *today*.** The often-quoted "20–35% faster" (from the ChatGPT report) is *optimistic for our current setup*, because so much of our cycle is the *one* lead engineer preparing scripts, resetting, rebuilding the index, reading screenshots, and merging — work a second machine can't split. The independent reviewer agreed: that estimate becomes realistic only *after* the robot turns testing into clean jobs that can be handed to any machine.

- **So the honest sequence is: robot first, machine right after.** The good news is the robot is only a few days of work, and a machine takes time to order and set up anyway — so you can **order the second machine now** and it'll be ready right as the robot lands. Just don't expect the machine itself to speed anything up before then.

- **When you do add the second machine, give the two different jobs:** one is the **fast scratch bench** for rough exploring; the other is a **pristine, locked-down "official verifier"** (fixed Windows and component versions) whose screenshots we can trust as the gold standard.

- **Don't buy a third physical machine.** Once the automatic Windows smoke test exists, just **rent cloud Windows machines on demand** — spin up as many as you want for a run, shut them off after, always with the *fake* data only. That scales better than boxes you have to maintain.

- **One thing to actively *not* do.** The Gemini report's whole hardware argument assumes our slowness comes from *compiling the Rust code several times at once and overheating one computer*, and it recommends elaborate "compile-sharing" infrastructure to fix that. **That is not our problem.** The heavy AI "thinking" runs on Anthropic's servers, not our box; our code-compiling is already cached and fast; and we already run only one heavy compile at a time on purpose. The independent reviewer confirmed this point-by-point against our actual setup. Buy a machine to add a parallel *test* lane — never to fix a compile bottleneck we don't have.

---

## 8. What the two outside reports got right and wrong

**The ChatGPT report — mostly right, worth listening to.** Its core idea matches mine: keep real-Windows as the final judge, but stop letting it be the place we first discover everything; push repeatable checks down into faster, same-every-time layers; make every serious Windows bug become a permanent test within a day; treat flaky tests as real defects; split the two machines into "scratch bench" vs "pristine verifier." Its main blind spot: it didn't know we *already* have the fake-AI tool, the browser suite, and the reset scripts — so several of its "build this" items are really "finish wiring up what we have."

**The Gemini report — a few good ideas wrapped around wrong assumptions.** The useful bits: make the AI behave the same every time (record/replay), use pre-built data so tests start instantly, and a real warning that automated Windows tests need a genuinely "logged-in" desktop session to work (we'll need that when we set up cloud Windows). But its headline framing is **wrong for us**: it assumes our slowness comes from compiling Rust many times on one overheating box, and proposes heavy compile-sharing infrastructure plus a "350–450% faster" projection. That diagnosis doesn't match how our system actually works (the independent reviewer checked it against our code and rejected every piece of it), so ignore that whole thread. It also pushes a niche tool ("xa11y") for driving native windows that we don't need — our current approach already reaches the parts that matter.

---

## 9. Independent cross-check (second AI engineer)

> *I had a second, independent AI engineer (a different model, Codex) read all three documents **and our actual test scripts**, and argue against them — so this report isn't just me agreeing with the research. Its verdict, in plain terms:*

- **It agreed on the real problem.** The #1 bottleneck is the slow, mostly-by-hand Windows proof loop — *not* anything about compiling code. It pointed at the exact scripts that prove it (one remote command per click; a multi-step, fiddly reset).
- **It agreed on the #1 fix:** build the persistent "test robot" out of our existing scripts. It even listed the same high-level commands I did (reset, sweep, ask, check-isolation, hand-back-evidence) and estimated a useful first version at roughly a few focused days, because the pieces already exist.
- **It backed the hardware call** — don't buy machines first; the "20–35% faster" figure is *high for today* and only becomes real after the robot exists.
- **It checked the Gemini report's claims against our actual code and rejected them** one by one: we already run a single compile at a time; we use a different search/indexing approach than the report assumed; the "350–450%" number doesn't fit our real cycle.
- **It added the sharpest point in this whole report:** because *AI agents are the testers*, the system needs clear, same-every-time, machine-readable proof more than it needs raw hardware. Fuzzy results make the AI fix the wrong thing. That's now baked into the plan above (the robot's clean pass/fail packets, the fake-AI replay, the evidence bundles).

In short: an independent model, looking at the real code, reached the same conclusions and made them sharper. That gives me high confidence in this plan.

---

## 10. Bottom line & what I recommend next

- **Our testing philosophy is right.** We don't need to test Windows less; we need to stop using the slow Windows laptop as the place we *first* find bugs.
- **Build one thing first: the "test robot."** It attacks *both* your pains at once (faster *and* fewer repeat bugs), it's only a few days because the parts exist, and it makes everything after it easier. Two independent analyses picked it as the top move.
- **Right behind it, the cheap trust fixes:** the "catch it once" rule and pointing our existing fake-AI + browser suite at the loop. Those two directly end the "same bugs over and over" feeling.
- **Then scale the speed:** pre-built world + automatic, unattended Windows smoke tests on rented cloud Windows.
- **On hardware: order the second machine now so it's ready, but the robot is the move that actually speeds you up — not the machine.** Skip the third box (rent cloud Windows instead), and skip the Gemini compile-sharing setup entirely.

**Recommended next step:** give me the go-ahead and I'll turn the **test robot + the two trust fixes** into a concrete build plan and start on it right away, with the cloud Windows smoke test teed up to follow. That's the fastest path to both "ships sooner" and "stops catching the same bugs."
