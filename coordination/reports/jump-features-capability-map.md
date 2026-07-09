# What would it take to match Jump's two new features?

*Assessment for Jameson, from the July 8 screenshot + the Jump scheduling help doc. Two separate features are in play — they're very different in difficulty.*

## Feature 1 — Meeting scheduling (the booking link)

**What Jump actually shipped:** a Calendly clone. An advisor shares a link, the client picks an open time, it checks the advisor's calendar for conflicts, creates the video meeting, and sends email/text reminders. Nothing AI about it — it's plumbing.

**What we already have that it builds on:**
- We already *connect to Calendly* (read-only today) — so we plug into that world already.
- We read Google and Microsoft 365 calendars (the auto-join feature does this now).
- We detect meeting links and we send email.

**What's missing:** the whole client-facing booking page — open-time slots, the public link, reschedule/cancel links, and text-message reminders (we have no texting today).

**My honest take:** this is a real build, but not a hard one, and there's a smarter path than rebuilding Calendly. Two options:
- **(a) Deepen the Calendly link we already have** — let advisors surface their Calendly booking inside Advisor Prep Hero. Fastest, leans on a tool advisors already trust.
- **(b) Build our own booking page** — more work (weeks), owns the experience end-to-end, adds texting cost.
- **Recommendation:** start with (a). Scheduling is table-stakes, not our differentiator — our edge is the private, cited intelligence, not being a calendar app. Don't spend our best weeks rebuilding Calendly.

## Feature 2 — Open accounts straight from the meeting (the screenshot)

**What the screenshot shows:** after a meeting, the advisor opens custodian accounts (Schwab), picks account types (IRA, Roth, Joint, Trust…), and Jump prefills the paperwork from the meeting/CRM, delivered three ways: Schwab's own digital open, a DocuSign envelope, or a prefilled PDF.

**What we already have that it builds on (a lot, actually):**
- A real Word/PDF generation engine (the `lantern-docx` engine) — we can produce prefilled documents today.
- A DocuSign connector already in the codebase.
- The Wealthbox CRM connection (client data to prefill from).
- The workflows engine with interview-style forms, and structured meeting summaries — the "facts" that would fill the forms.

**What's genuinely hard / not just code:**
- **The Schwab "digital open" is a partnership, not a feature.** Opening real accounts through Schwab's system means becoming an approved Schwab integration partner — a business and compliance relationship, not something we can code our way into. Jump has that partnership; we'd have to earn our own.
- We don't have the actual account-opening form templates (IRA/Roth/Trust) yet.

**My honest take:** there's a real, achievable slice here and a gated part.
- **Achievable now:** "prefill the account paperwork from the meeting and hand you a filled PDF (or a DocuSign envelope to send)." We have the engine, the CRM data, and the meeting facts. This is a strong, demo-able feature that stops short of the custodian.
- **Gated:** the one-click "open it at Schwab" is a custodian partnership we'd pursue separately, later.

## Bottom line for a two-minute answer
- **Scheduling:** easy-ish, but probably not worth building ourselves — deepen the Calendly tie instead.
- **Account-opening:** the *prefilled-paperwork* half is very buildable on what we already have and would be a genuine "wow"; the *one-click-Schwab* half needs a Schwab partnership we don't have yet.
- **Neither is a tonight thing** — both are real features to scope and decide on deliberately, and both touch client data + compliance, so they deserve a proper plan, not a quick build.
