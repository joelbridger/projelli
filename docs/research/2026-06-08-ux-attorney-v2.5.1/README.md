# Advisor Prep Hero v2.5.1: Attorney UX Research Package

**Created:** 2026-06-08
**Owner:** Research (Dr. Lena Whitfield persona) for Advisor Prep Hero
**Segment:** Solo and small-firm attorneys (locked primary ICP)
**Status:** Pass A (synthetic deep first pass) complete. Instruments ready for Pass B (real participants) on the 2.5.1 release.

---

## What this is

A complete, research-grade UX study of Advisor Prep Hero 2.5.1 from the point of view of the target attorney, plus every reusable instrument needed to run it again with real, paid participants the moment the build ships.

It was run in two passes by design:

- **Pass A (this package, now):** a deep synthetic first pass. A rigorously built composite attorney is interviewed for a full hour and then taken through an hour-long, task-based usability test of the documented v2.5.1 product. The point is to generate and rank the hypotheses most worth paying real money to confirm, and to surface the obvious problems before a single recruited participant is in the room. Findings are labeled as hypotheses, not proof.
- **Pass B (on release):** the same screener, discussion guide, and usability protocol, run with 5 to 7 recruited attorneys against the live binary. Nothing needs to be re-written. Swap the synthetic participant for real ones and go.

This two-pass structure is the preparation that was requested: when 2.5.1 is released, the study is ready to run as-is, and these synthetic findings become the prior you test against.

Pass A now also integrates two independent deep-research reports (a litigation-operations review and a public-record diligence pass) alongside the two synthetic sessions, making the findings a four-source synthesis. Where the evidence challenges current decisions about the customer, the architecture, or the product's identity, the report surfaces that as a strategic choice rather than filtering it out.

---

## The 60-second version of what we found

Four independent sources now point the same way (two synthetic sessions and two deep-research reports), so the high-confidence findings are close to safe bets. Advisor Prep Hero has a strong wedge and an honest architecture, wrapped in a story that overclaims in one place, under-explains in another, and has not yet decided whether it is a tool for one lawyer or a platform for a firm.

1. **The email feature is the wedge. Lead with it.** "Find anything you have ever emailed, privately" was the moment it clicked, the thing she said would make her pay. The "AI workspace" framing buries it. (All four sources.)
2. **The central promise has an asterisk you are not telling.** "Nothing leaves your machine" is true about Advisor Prep Hero's servers, not about the AI provider, who still sees the prompt unless the user runs a local model. Lawyers read fine print for a living. Tell the whole truth and add a visible "where is this going" indicator.
3. **The biggest usability failure: she cannot explain where her data goes.** For a lawyer, an uncertain answer is a disqualifying answer. The product does the right thing; she cannot tell. A communication fix, and the most valuable one.
4. **The citation is the price of admission, not a feature.** A cited answer won her; an uncited one would have destroyed trust in every answer.
5. **Trust, proof, and basic governance are missing, for an audience that does diligence for a living.** Zero attorney testimonials, no SOC 2 or DPA, a one-person vendor, and public documents that contradict each other on pricing, licensing, and versions.
6. **Two identity choices collide with two legal duties.** Plaintext Markdown storage (a selling point) versus confidentiality at rest; and saving every AI chat versus discoverable work product.
7. **The real question is who the customer is.** An excellent solo sidecar today; not a firm platform (no collaboration, no document-management integration, no assurance). Win the solo wedge, or invest to serve firms. That is a board-level choice, surfaced in the report's strategic-forks section.

Full findings, the four-source evidence matrix, the strategic forks, and recommendations prioritized by real-world impact are in the [report](report/analysis-and-report.md).

---

## How to navigate this package

| File | What it is |
|---|---|
| [report/analysis-and-report.md](report/analysis-and-report.md) | **Start here.** Four-source synthesis: executive summary, strategic findings, severity-rated usability findings, strategic forks, and recommendations prioritized by real-world impact. |
| [vision-most-viable-keepance.md](vision-most-viable-keepance.md) | **Vision.** Ignoring development difficulty, the single most viable version of the product, grounded in all four sources. Commits to the strategic forks rather than presenting options. |
| [personas/attorney-persona.md](personas/attorney-persona.md) | Diane Marchetti, the target attorney and study participant. |
| [personas/researcher-persona.md](personas/researcher-persona.md) | Dr. Lena Whitfield, the moderator, and the method she works by. |
| [instruments/research-plan.md](instruments/research-plan.md) | Objectives, research questions, methodology, scope and limits. |
| [instruments/screener.md](instruments/screener.md) | Recruiting screener for Pass B (quotas, qualifying questions, incentive). |
| [instruments/discussion-guide.md](instruments/discussion-guide.md) | The ~60-minute generative interview script. |
| [instruments/usability-test-protocol.md](instruments/usability-test-protocol.md) | The ~60-minute usability test: 5 tasks, success criteria, metrics, consent. |
| [transcripts/interview-transcript.md](transcripts/interview-transcript.md) | Full interview transcript (~10,400 words). |
| [transcripts/usability-test-transcript.md](transcripts/usability-test-transcript.md) | Full usability test transcript with think-aloud and observations (~15,300 words). |
| [deep-research-reports/Attorney UX Review of Advisor Prep Hero.md](<deep-research-reports/Attorney UX Review of Advisor Prep Hero.md>) | Supplementary AI deep-research report. Evaluative UX and workflow analysis from a senior litigator's perspective, written as a simulated interview plus thematic analysis. Separate source from the Pass A package, kept for reference. |
| [deep-research-reports/ChatGPT deep research attorney UX report Advisor Prep Hero.md](<deep-research-reports/ChatGPT deep research attorney UX report Advisor Prep Hero.md>) | Supplementary AI deep-research report (ChatGPT), grounded in the public record with inline citations. Senior-attorney review of the v2.x product. Separate source from the Pass A package, kept for reference. |

---

## How to run Pass B when 2.5.1 ships

1. **Recruit** 5 to 7 attorneys with [the screener](instruments/screener.md). Aim for the quota grid (mix of solo and small firm, litigation and transactional, email providers, and AI exposure). Budget the honorarium; do not under-pay or you bias the sample.
2. **Prepare a clean test environment** per the usability protocol: fresh install of the live 2.5.1 build, a clean test license, a test AI key available, and a **test mailbox of realistic but non-confidential email** (never a participant's real client mail on a recorded call).
3. **Run Session 1** (interview) with [the discussion guide](instruments/discussion-guide.md), then **Session 2** (usability) with [the protocol](instruments/usability-test-protocol.md). Same week is fine.
4. **Re-verify the tactical usability findings against the shipped UI.** The Pass A usability detail was drawn from documentation, not the running binary. Anything that changed in the final build supersedes what is written here.
5. **Confirm the load-bearing findings first** (see report Section 7): the email-wedge resonance, the data-location comprehension failure, and the API-key drop-off. These three decide the roadmap.
6. **Update the report** with real findings, keeping the Pass A hypotheses visible alongside, so you can see what held and what did not.

---

## Honest limitations

- Pass A is a simulation grounded in product documentation, not observed behavior on the live binary. Its job is to prioritize what to confirm, not to confirm it.
- One composite archetype (small-firm litigator). Transactional, IP, and in-house attorneys will differ, especially on output formats and how much the email wedge matters.
- The SUS (65) and per-task SEQ numbers describe one participant's modeled experience. They illustrate how the real instrument behaves; they are not a measured score. Do not over-index on them.

> Note: one small label divergence exists between the usability protocol (which describes the Pass B test environment) and the usability transcript header (which is marked Pass A, since it is the synthetic run). This is intentional and noted here so a future reader is not confused.
