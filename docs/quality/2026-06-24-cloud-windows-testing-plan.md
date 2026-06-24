# Cloud Windows testing — the plan, with real numbers

**For:** Jameson
**From:** your lead engineer
**Date:** 2026-06-24
**What this is:** the straight answer to "can cloud Windows let us test a lot, very quickly?" — with real costs, real speeds, what it can and can't cover, and what I'd build. You asked for the plan before I build anything; here it is.

---

## 1. The honest headline

**Yes — but with one important correction to the picture.**

The "test a *huge amount*, very fast" superpower is **not** the Windows part. It's the **browser tests** — and those just went live as your gatekeeper today. They run in a plain web browser (not the real Windows app), so they run on cheap ordinary machines, **hundreds at once, in a few minutes, for pennies**. That's your high-volume engine.

**Cloud Windows** is a different, smaller-but-deeper layer: it tests the *real installed app* — the things only real Windows shows (the WebView2 screen rendering, file pop-ups, OS file paths). You don't have hundreds of those; you have maybe **10–30 deep "does the real thing actually work" flows.** Cloud Windows lets you run *those* automatically, in parallel, fast — so you're not driving them by hand on the one laptop.

So: **a lot, very quickly = the browser gate (done). The real app, in parallel, automatically = cloud Windows (this plan).** Both matter. They're different jobs.

---

## 2. The key trick that makes it fast (and cheap)

The slow, expensive part of testing the real Windows app is **building it** — compiling the app from scratch on a Windows machine takes roughly **20–30 minutes cold**. If every test run rebuilt the app, cloud Windows would be slow and we'd be "scaling a slow process" (the exact trap the main report warned about).

**The fix: build once, test the artifact many times.** We already make a built Windows app in our release process. The plan is: one machine builds the app and saves it; then **any number of cheap Windows machines just download that finished app (about 30 seconds) and drive it** — with the saved-answer AI (no live model) and a pre-built demo workspace (no slow re-indexing). Each test machine then spends its time *testing*, not building.

With that, a single real-app test run on a cloud Windows machine looks like:

| Step | Time |
|---|---|
| Download the pre-built app | ~30 sec |
| Load the pre-built demo world (no re-index) | ~30 sec |
| Drive the flows (reset → open → sweep → ask → isolation, etc.) | ~1–3 min |
| **Total per machine** | **~3–5 min** |

Run ten of those **in parallel**, and a full real-app sweep finishes in about the time of one — ~5 minutes.

---

## 3. Real cost numbers (confirmed today)

GitHub rents Windows machines by the minute. As of Jan 1, 2026 the price **dropped 39%**:

- **Rented (GitHub-hosted) Windows: $0.010 / minute** for our private code.
- **Self-hosted Windows (a machine we own, like the Legion, or a cheap always-on Windows box): the minutes are FREE** (GitHub's planned charge for these was cancelled in Dec 2025).

What that means in practice:

| Scenario | Math | Cost |
|---|---|---|
| One ~5-min real-app run, rented | 5 min × $0.01 | **~$0.05** |
| A full sweep: 10 machines in parallel, ~5 min each | 50 machine-min × $0.01 | **~$0.50** |
| Same sweep, 20× a day | ~$0.50 × 20 | **~$10 / day** |
| Same sweep on a **self-hosted** Windows box | free minutes | **$0** (just the electricity) |

Translation: cloud Windows testing is **cheap** at the volume we'd use — well under your "I don't care about cost" bar. The build machine adds a one-time ~20–30 min build per code change (also pennies, and cacheable down to ~5 min).

---

## 4. The real catches (so there are no surprises)

These are the things that make it *real engineering*, not a switch we flip:

1. **Windows GUI apps need a real "logged-in desktop" on the runner.** The app's screen (WebView2) won't draw in a bare background service. Rented GitHub Windows runners can do this, but it needs setup and proving-out — this is the #1 thing to validate in a small spike first. (Both outside research reports flagged it; it's the known gotcha.)
2. **Native file pop-ups are hard to automate in the cloud.** The "choose a folder" Windows dialog is driven on the physical Legion by a little robot that moves the mouse — that's fiddly in a rented cloud machine. So **native-dialog flows stay on the physical bench**; cloud Windows covers everything driven through the app's screen (which is most of it).
3. **Privacy:** cloud Windows runs only ever touch the **fake "Northcrest" data** — never real client files. (That's all we test with anyway, so this is fine, but it's a hard line.)
4. **We need the "build once, share the artifact" pipe** and the "pre-built world" snapshot built first — those are what make it fast. Without them, it works but it's slow.

---

## 5. The options (and what I'd recommend)

| Option | What it is | Speed / coverage | Cost | Effort |
|---|---|---|---|---|
| **A. One rented Windows smoke (spike first)** | One GitHub Windows machine downloads the built app and runs the robot smoke automatically | Proves it works; ~5 min/run once warm | ~$0.05/run | Low — a few hours |
| **B. Self-hosted Windows runner** | Make the Legion (or a cheap always-on Windows box) a runner; it's always warm (no rebuild) | Fastest per-run (no download/build); 1 machine = serial | $0 minutes | Low–medium |
| **C. Parallel rented fleet** | N rented Windows machines, flows split across them | Widest, fastest full sweep | ~$0.50/sweep | Medium — needs A working first |

**My recommendation — and it matches your "plan first" call:** start with **a 1-machine spike (Option A or B)**. Build the "download the app + drive it" pipe once, prove the GUI-on-a-runner catch is solved, and **measure the real time and cost on our actual app** (my numbers above are solid estimates, but a spike turns them into facts). If the spike proves out — and I expect it will — scaling to the parallel fleet (Option C) is then a small step.

Self-hosted (Option B) is the sleeper pick if you want it dead-simple and free: the Legion is already set up and always warm, so it skips the download/build entirely. The only downside is it's one machine (serial), where rented machines give you many-at-once.

---

## 6. Bottom line

- **You already got the "test a lot, very fast" win today** — the browser gatekeeper. That's the high-volume engine, and it's cheap and parallel.
- **Cloud Windows adds automatic, parallel testing of the *real* app** — fewer, deeper flows, run hands-free instead of one-at-a-time on the laptop. It's **cheap** (~$0.05/run, or free self-hosted) and **fast once we "build once, test many."**
- **The smart first move is a small spike** to turn my estimates into measured facts and to solve the one real gotcha (GUI on a rented runner) cheaply, before committing to a fleet.

**If you say go, the first step is the spike** — one Windows machine, the robot smoke running on it automatically, with real timing and cost reported back. No big commitment, and it answers the last open question for real.
