# Beating Jump on scheduling + account-opening — the plan

*Fable's plan for the two Jump features you want. Both are real, both are winnable, and they're very different jobs. I've grounded every claim in what our code actually has today (a scout mapped the exact seams). Read the two "decision" boxes — those are the only things I need from you before I build.*

---

## Part 1 — The Calendly clone (booking links)

### The good news: we're already 60% of the way there
We already read Outlook, Google, and iCloud calendars, we already know how to detect and handle meetings, our times are already stored in a clean universal format, and we can already send email (for confirmations and reminders). That's most of the plumbing a booking tool needs.

### The three things we don't have yet
1. **Writing to the calendar.** Today we only *read* calendars. Creating a booked event needs new "write" permission — which means every advisor re-approves their calendar connection once (a one-time reconnect).
2. **Creating the video link.** We detect Teams/Zoom/Meet links today; we don't *make* them. We'd add that.
3. **The booking page itself** — the availability rules, the public page a client visits, reschedule/cancel. All net-new (clean slate, which is good — no legacy to fight).

### 🟦 THE ONE DECISION I NEED FROM YOU
A booking page is a page your *client* opens from the internet — even when your laptop is closed and asleep. **It cannot live on the advisor's machine.** This rubs directly against our whole identity: "nothing leaves your computer." So we have to decide where the booking page lives. Two honest options:

- **Option A — Privacy-preserving (my strong recommendation).** We already run a small server (the firm backend). It hosts *only* booking-safe data: your public name, your bookable time windows, and a "busy/free" snapshot of your calendar — **never client names, files, or notes.** When a client books, your laptop wakes up, confirms it, and writes the real event. **Why I recommend it:** it keeps our promise intact — no confidential client data ever leaves the machine, only your empty/busy time slots do (which is all Calendly sees anyway). It's the honest version of "private scheduling."
- **Option B — Instant Calendly-style.** The server holds a live key to your calendar so bookings confirm instantly without your laptop. Slightly smoother, but it means our server can now touch your calendar directly — a real dent in the local-first promise. I'd avoid it unless you specifically want it.

*My recommendation: Option A. It's the version that lets us honestly say "even our scheduling respects your privacy" — which is a selling point Jump can't match, not a compromise.*

### How I'd build it (once you pick A)
- **Phase 1 — Availability + a booking page.** Advisor sets working hours, meeting lengths, buffers, and gets a shareable link (`book/your-name`). The page shows open slots from the busy/free snapshot. This alone is a demo-able "we have scheduling" moment.
- **Phase 2 — Real booking.** Client picks a slot → creates the calendar event on both sides, makes the video link, sends confirmation email with reschedule/cancel links.
- **Phase 3 — Reminders + polish.** Email reminders with templates (text reminders later — needs a texting vendor, small add). Multiple meeting types.

I lead the architecture; Codex builds the volume under my review, same as everything this week. Elegant and robust, wired seamlessly into the Meetings area we just cleaned up.

---

## Part 2 — Open accounts from the meeting (the Schwab feature)

### The honest split: one half is buildable now, one half is a locked door
- **Buildable now, no permission needed:** after a meeting, Advisor Prep Hero prefills the Schwab account paperwork (IRA, Roth, Joint, Trust, Custodial…) from the meeting facts and CRM, and hands the advisor a filled, ready-to-sign document (PDF or DocuSign envelope). We already have the document engine, the CRM connection, and the meeting data. This is a real, strong feature that stops just short of Schwab's own system.
- **The locked door:** the "click inside our app and it opens at Schwab" magic (what the screenshot shows) lives behind **Schwab's approved-partner program.** Schwab's own research confirms: their Digital Account Opening supports exactly those account types and lets approved partners pass up to 50 prefilled data points in. But getting approved is **a year-plus of relationship, security audits, and legal work — the coding is the easy part; the locked door is Schwab's approval.**

### 🟦 THE DECISION HERE
This isn't a "build it" decision, it's a "start the relationship" one. My recommendation, in order:
1. **Build the prefilled-paperwork half now** — it's genuinely useful, it's a real Jump-competitive feature, and it needs nobody's permission.
2. **In parallel, start the Schwab partnership clock** — because it takes a year, the sooner you apply, the better. I've saved the full research (the programs, the requirements, who to contact). This is a *you + business* task, not a coding task — I can draft the application and prep the security documentation (SOC 2 posture, data handling) so you're ready to apply.
3. Schwab integration is genuinely valuable to advisors (it's a top reason they pick a tool), so it's worth starting — just with eyes open that it's a long game.

---

## What I need from you (two quick answers, no rush)
1. **Calendly hosting:** Option A (privacy-preserving, my rec) or B (instant)?
2. **Schwab:** want me to (a) build the prefilled-paperwork feature now, and (b) draft the Schwab partner application + security docs so you can start that clock?

Once you answer #1, I start building the booking feature. Everything else (the demo, the whole UI overhaul) is already done and waiting for you.
