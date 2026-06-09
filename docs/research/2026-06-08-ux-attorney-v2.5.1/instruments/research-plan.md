# Keepance v2.5.1: UX Research Plan (Attorney Segment)

**Prepared by:** Dr. Lena Whitfield, Principal UX Researcher
**Date:** 2026-06-08
**Product version under study:** Keepance 2.5.1 (email-intelligence release; in final build at time of writing)
**Segment:** Solo and small-firm attorneys (primary locked ICP)

---

## 0. Status and how to read this

This plan governs a **two-session study**: a ~60-minute generative interview and a ~60-minute moderated usability test.

It is being run in two passes:

- **Pass A: Synthetic first pass (this deliverable, now).** Conducted against the *documented* v2.5.1 product (FEATURES.md, the strategy and design docs, the onboarding source, the sample workspace) using an evidence-grounded composite participant ([Diane Marchetti](../personas/attorney-persona.md)). Purpose: a deep, cheap, fast hypothesis-generation pass that sharpens the real study and surfaces the issues most worth paying to confirm. Findings are labeled as hypotheses, not proof.
- **Pass B: Real participants (on release).** The same instruments (this plan, the [screener](screener.md), the [discussion guide](discussion-guide.md), the [usability protocol](usability-test-protocol.md)) run with recruited attorneys against the live 2.5.1 build. Everything here is built to be reused verbatim, swapping the synthetic participant for real ones.

**This is the preparation Jameson asked for:** when 2.5.1 ships, the instruments are ready to run as-is, and the synthetic findings become the prior we test against.

---

## 1. Background

Keepance is a local-first, desktop AI workspace for confidential professional work. Its bet is that privilege- and confidentiality-bound professionals (lawyers first) cannot safely pipe client work into cloud AI, and that a local-first, bring-your-own-key tool removes the vendor from the data path. v2.5.1 adds the strategic wedge: **local-first email import, search, and AI retrieval** (Microsoft 365, IMAP, Gmail), with encryption at rest, aimed squarely at the universal attorney pain of "I can't find anything in Outlook."

A prior internal persona audit (2026-06-03) role-played five verticals and concluded the core problem is not capability but translation: *"Keepance is a developer-grade tool wearing a professional's suit."* This study exists to pressure-test that conclusion with research-grade method, against the email release specifically, and to convert it into a prioritized action plan.

---

## 2. Objectives

1. Understand the target attorney's real world: workflows, tools, goals, and ranked pains, in her own language.
2. Test whether Keepance's core value proposition (local-first, your data stays yours, AI without third-party disclosure) is *understood and believed*, not merely stated.
3. Evaluate the critical path to first value: install to workspace to API key to first useful output. Locate where it breaks.
4. Evaluate the v2.5.1 email wedge end to end: connect, encrypt comprehension, search, and ask-the-AI-about-your-mail. Does it deliver the "finally" moment?
5. Separate capability gaps from communication gaps, because they need opposite fixes.
6. Identify the honest blockers to adoption for *real* client work (not a trial), and what would convert a skeptic to a daily, paying user.
7. Produce a prioritized, sequenced set of strategic and tactical recommendations.

---

## 3. Research questions

**Strategic / positioning (high-level)**
- RQ1. What is the most acute, frequent, fundable pain in this attorney's week, and is it the one Keepance leads with?
- RQ2. Does "local-first / your data never leaves your machine" register as a *purchase driver*, a *nice-to-have*, or *noise*? Can she articulate it back correctly?
- RQ3. Is the email wedge a strong enough reason to adopt on its own, or only in combination with the workspace and workflows?
- RQ4. How does the compliance/regulatory framing land: as trustworthy specificity, or as overclaiming that triggers her skepticism?
- RQ5. Where does Keepance sit in her stack relative to Clio, Outlook, and Word, and is that position clear?

**Tactical / usability (low-level)**
- RQ6. Can a non-technical attorney complete onboarding (workspace + API key) unaided? Where exactly is the friction?
- RQ7. Does she understand the file/workspace/Markdown model, and does the output meet her "it has to look like a real document" bar?
- RQ8. Can she connect email and correctly explain what happened to it (where it lives, whether it's safe)?
- RQ9. Can she successfully search her mail and get a cited answer from the AI? Is the value self-evident at that moment?
- RQ10. How does she interpret trust signals: the audit log, cost tracking, encryption indicators, license model?

---

## 4. Methodology

**Design:** Two sequential moderated sessions with the same participant, mirroring how the real study will run (one recruit, two back-to-back or same-week sessions).

**Session 1: Generative depth interview (~60 min).** Semi-structured, JTBD-informed. No product shown until the final reaction segment. Goal: context, workflows, pains, mental models around AI and confidentiality, and unled reactions to the *concept* before the *interface*. Instrument: [discussion-guide.md](discussion-guide.md).

**Session 2: Moderated usability test (~60 min).** Task-based, think-aloud, against the v2.5.1 product. Five task scenarios spanning the make-or-break flows: onboarding + API key, run a legal workflow + export, connect email + understand encryption, search email + ask the AI, and trust/audit comprehension. Success criteria, expected paths, and metrics defined per task. Instrument: [usability-test-protocol.md](usability-test-protocol.md).

**Measures**
- Qualitative: themes, JTBD, mental-model accuracy, quotes, observed friction and delight.
- Quantitative (usability): task success (success / partial / fail), assisted vs unassisted, observed time-on-task band, error/confusion events, Single Ease Question (SEQ, 1-7) per task, System Usability Scale (SUS) at the end.
- Severity rating per usability finding (0-4 scale; see protocol).

**Analysis:** Thematic synthesis + affinity grouping, usability findings rated by severity, capability-vs-communication labeling, triangulated into a positioning and roadmap recommendation set. Output: [report/analysis-and-report.md](../report/analysis-and-report.md).

---

## 5. Participant

**Pass A (now):** One composite participant, [Diane Marchetti](../personas/attorney-persona.md): 54, solo/small-firm civil litigator, 24 years in practice, Cleveland. Chosen because litigation maximizes overlap with both the email wedge (discovery, deposition prep, "what did the client say") and the existing Legal Practice templates, and because a 20+ year veteran is an opinionated, articulate participant who produces rich data and a hard test of the compliance claims.

**Pass B (on release):** Target n = 5-7 recruited attorneys per the [screener](screener.md), mixed across litigation and transactional, solo and 2-10 attorney firms, varied AI exposure. Five is the floor for usability (catches the majority of severe issues); aim for 6-7 to cover practice-area variation.

---

## 6. Scope and limits (stated honestly)

- Pass A is a **simulation grounded in documentation**, not observed behavior on the live binary. Its job is to generate and prioritize hypotheses, not to confirm them. Every finding here carries a validation flag for Pass B.
- The composite participant is one archetype (small-firm litigator). Transactional, IP, and in-house attorneys will differ, especially on output formats and the email wedge's relevance. The instruments are built to flex across these; Pass A does not cover them.
- Usability observations describe the documented v2.5.1 flows. Anything that changed in the final build must be re-checked against the screen.
- No quantitative claim from Pass A is statistically meaningful. SEQ/SUS numbers here are illustrative of the participant's experience, to model how the real instrument behaves, not to report a score.

---

## 7. Deliverables

1. Two personas (participant + facilitator). ✅
2. This research plan. ✅
3. Recruiting screener (reusable). → [screener.md](screener.md)
4. Discussion guide for the interview (reusable). → [discussion-guide.md](discussion-guide.md)
5. Usability test protocol with tasks, criteria, metrics, consent (reusable). → [usability-test-protocol.md](usability-test-protocol.md)
6. Full interview transcript. → [../transcripts/interview-transcript.md](../transcripts/interview-transcript.md)
7. Full usability test transcript. → [../transcripts/usability-test-transcript.md](../transcripts/usability-test-transcript.md)
8. Analysis and report with prioritized recommendations. → [../report/analysis-and-report.md](../report/analysis-and-report.md)
