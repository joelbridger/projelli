# Landing the first 3 to 5 advisors: the distribution plan

**Status:** Draft, ready and waiting. Prepared 2026-06-28.
**Owner:** Jameson.
**Rule for this whole folder:** prepare and draft only. Nobody gets contacted until Jameson says go. Everything customer-facing here is a draft.

This is the distribution side of the proof sprint (`docs/strategy/2026-06-25-proof-sprint/`). The proof sprint says what success is: 3 to 5 financial advisors using Keepance every week within 45 to 60 days, with 1 to 2 paying. This folder is the plan and the assets to make that happen, sitting loaded so the day the demo is solid, there is nothing left to write.

---

## Part A: the honest assessment

### What already exists (more than you'd think)

The strategy and most of the words are already done. The pieces are just scattered, and some still wear their old lawyer clothes. Here is the real inventory.

**Strategy and research (solid, current):**
- The advisor re-aim brief, the ecosystem map, and the regulatory foundation (Reg S-P, books-and-records, the "never say compliant" rules).
- The locked positioning: Keepance is the private layer over the tools an advisor already pays for, not a thirteenth tool. Source: `docs/strategy/positioning/WHERE-KEEPANCE-FITS.md`.
- The proof sprint plan with a 60-day scoreboard, and a competitor read on FutureVault.

**Product and demo (close, the real gate):**
- The website is already fully advisor-facing.
- There is an advisor sample household ("Hendricks") and a real Client Map screen in the app.
- The 4-step demo is being finished by a separate build session.

**Customer-facing words already written (reuse these, don't redo):**
- The "where your client data goes" trust sheet, ready for a compliance officer. `docs/strategy/2026-06-25-proof-sprint/03-where-your-data-goes-trust-sheet.md`. Strip its internal note before sending.
- A warm-intro note the wife can forward to her advisor, plus a direct version. `docs/marketing/campaigns/2026-06-design-partners/JOURNEY_BEYOND_WEALTH.md`.
- A testimonial ask. `docs/marketing/campaigns/2026-06-first-dollar/TESTIMONIAL_ASK.md`.

**A proven outreach machine, but built for lawyers:**
- A real motion is already live and working for attorneys: 40 honest-researcher emails went out, advisors book a phone time at cal.com, Jameson calls them through the Quo app, and the call records itself, writes itself up, and files into the CRM automatically. The plumbing exists. It just points at litigators right now. Source: `~/keepance-lawyer-interviews/PLAN.md` and memory `project_keepance_lawyer_outreach`.

### The gap to "first 3 to 5 advisors"

Five things are missing, and they are the reason this folder exists.

1. **No single assembled plan.** The wife-demo playbook covers user #1. Nothing maps the path from her to her firm to a few outside advisors as one sequence. (This README fixes that.)
2. **The outreach words are lawyer-generic.** The design-partner templates say "solo attorney, CPA, consultant." Advisors need their own messages. (Drafted: `OUTREACH-ADVISORS.md`.)
3. **No advisor discovery-interview campaign.** The lawyer interview script asks about cases and privilege. Advisors need their own. (Drafted: `DISCOVERY-INTERVIEW.md`.)
4. **No clean, repeatable demo script.** The session plan is "how to read your wife honestly," which is great for her. It is not a runbook you can re-run for advisor #2, #3, #4. (Drafted: `FIRST-DEMO-SCRIPT.md`.)
5. **No warm, forwardable one-pager.** The trust sheet is about data only. The FutureVault doc is internal. There is no single warm "here is why this is for you" page to hand an advisor. (Drafted: `WHY-KEEPANCE-FOR-ADVISORS.md`.)

### The one strategic correction worth saying out loud

The lawyer motion leaned on cold email. For advisors, that is the weak channel, and the research is blunt about it. Advisors buy software roughly 49% from seeing a demo and 43% from a peer telling them, and they mostly ignore cold outreach.

So the advisor version is not "send 40 cold emails." It is **warm intros and demos first, discovery interviews second, cold email last (if ever).** Same plumbing, different weighting. The wife is not just user #1, she is the doorway to everyone after her.

---

## Part B: the prioritized landing plan

Think of it as rings around the warmest center. Each ring earns the next: a happy user gives you a testimonial and an intro, and that intro is the start of the next ring.

### Ring 0 — User #1: the wife (the seed)

The single most important meeting of the sprint. Goal is not a sale, it is to learn whether she'd really use it weekly, and to turn her into user #1: she imports one real client and uses Keepance before a real meeting within about a week.

- **Owner:** Jameson.
- **Assets:** `FIRST-DEMO-SCRIPT.md` (the runbook) plus the wife-specific reading guide in `docs/strategy/2026-06-25-proof-sprint/01-design-partner-session-plan.md`.
- **Gate:** the demo has to be bulletproof first. This is the true blocker, and it is engineering's job, not distribution's.

### Ring 1 — Her firm (Journey Beyond Wealth)

Through the wife, learn how her firm actually buys software, who the compliance gatekeeper is, and what tools they already run. Then ask for one or two warm intros to colleagues. Hand the trust sheet to whoever does compliance.

- **Owner:** Jameson.
- **Assets:** the trust sheet, `WHY-KEEPANCE-FOR-ADVISORS.md`, the forwardable warm-intro note.

### Ring 2 — The warm advisor network

Any advisor the wife or Jameson already knows, plus one-hop intros from ring 1. Warm, one at a time, personal.

- **Owner:** Jameson.
- **Asset:** the warm-network message in `OUTREACH-ADVISORS.md`.

### Ring 3 — Peer and community advisors

Where you go when the warm circle runs thin. Not a blast. A small, personal, honest-researcher discovery-interview motion, run through the advisor communities where peers actually trust each other: XY Planning Network, the Kitces community, advisor podcasts and AdvisorTech roundups. Good interviews turn into demos, and demos turn into pilots.

- **Owner:** Jameson runs the calls. Claude builds the plumbing and drafts each message for approval.
- **Assets:** `DISCOVERY-INTERVIEW.md`, plus the cal.com + Quo + CRM setup (mirror the lawyer build).

### The scoreboard (from the proof sprint, pinned here)

| Metric | Target by ~day 60 |
|---|---|
| Advisors who watched a real demo | 5 to 8 |
| Advisors using it weekly on real clients | 3 to 5 |
| Paying, even a small pilot | 1 to 2 |
| Warm intros to new advisors | 3+ |

### A realistic sequence

- **Now (gated on a solid demo):** rehearse, then run the wife demo.
- **Weeks 1 to 2:** wife becomes user #1. Learn the firm. Get the first warm intros.
- **Weeks 2 to 4:** demo one or two firm colleagues. Hand the trust sheet to compliance. Open the first paid-pilot conversation.
- **Weeks 3 to 6:** stand up the discovery-interview plumbing. Do 5 to 8 community interviews. Turn the pilot-curious into demos.
- **Weeks 6 to 8:** 3 to 5 weekly users, 1 to 2 paying. Capture testimonials. Call it: validated, or not, and know exactly why.

---

## Part C: index of the drafts in this folder

| File | What it is | Audience | Reuses |
|---|---|---|---|
| `WHY-KEEPANCE-FOR-ADVISORS.md` | Warm, forwardable one-pager on why this is for advisors. | Advisors (customer-facing). | Positioning doc + ecosystem fit. |
| `OUTREACH-ADVISORS.md` | The four outreach messages: forwardable intro, Jameson-direct, warm network, community peer. | Advisors (Jameson sends). | Re-aims the design-partner OUTREACH + JBW notes. |
| `DISCOVERY-INTERVIEW.md` | The honest-researcher interview invite + the question set, advisor version. | Advisors (Jameson runs). | Mirrors the live lawyer interview script. |
| `FIRST-DEMO-SCRIPT.md` | A clean, repeatable runbook for the 4-step demo. | Internal (Jameson drives). | Builds on the wife session plan, made re-runnable. |

What I deliberately did **not** redo, because it already exists and is good: the trust sheet, the FutureVault one-pager, the testimonial ask, and the website "where Keepance fits" copy.

---

## Part D: what Jameson needs to decide or do to start

### Decisions (yours to make)

1. **Do the first pilots pay, or are they comped?** My take: comp the wife and her firm colleague as true design partners, because you want brutal honesty more than their money at that stage. For anyone past that warm core, offer the normal Solo plan or a small founding-pilot price, because the scoreboard needs 1 to 2 actually paying and a paid pilot is the realest signal there is.
2. **Run cold email to advisors at all, or stay warm-only?** My take: stay warm-first and hold the cold email. Advisors ignore cold outreach, so spend the energy on intros and demos. Keep cold as a backup if the warm circle dries up.
3. **Greenlight the plumbing now?** My take: yes. Let me stand up the advisor research-call setup (a cal.com time, a CRM project, the Quo recording, a simple research page like the lawyer one) so it is ready the moment you want ring 3. This is build-only, contacts nobody.
4. **The wife and firm name in the assets.** I left placeholders. Tell me how you want her referred to (or keep it blank) before anything is sent.

### Things only you can do

- Get the demo bulletproof (engineering, but it is the gate everything waits on).
- Run the wife demo with the script.
- Make the pricing call above.
- Greenlight the plumbing build.

### Things I can do the moment you greenlight

- Build the advisor research-call setup (cal.com + CRM + Quo + research page), contacting no one.
- Personalize each outreach message for a specific named advisor.
- Build a small, real target list of community advisors (XYPN, Kitces) for ring 3.
- Run the inbox: draft every reply and follow-up for your approval, never auto-send.

---

## Honesty guardrails (bind everything in this folder)

- **No compliance claims.** Never "compliant," "Reg S-P compliant," or "SEC-approved." The honest line is: client data stays on your machine, which lowers your vendor-review burden. It does not erase your duties. Full do-not-say list in `docs/strategy/VERTICAL_FINANCIAL_ADVISORS_2026-06.md` §4.
- **The cloud-AI caveat is always told.** "Data never leaves your machine" is only fully true in local (Ollama) mode. With a cloud key, the provider you chose still sees your prompt. Say so.
- **No em dashes, first person, contractions** in every customer-facing draft. Voice rules: memory `feedback_jameson_voice_profile`.
- **Testimonials are never part of a deal.** They come only if the product earns one, with written permission for the name and the wording.
