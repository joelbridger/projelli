# Lantern-Plus Backlog — decided, not in the current waves

*Items that were consciously dispositioned during the 2026-07-02 Jump completeness
sweep (see `2026-07-02-JUMP-COVERAGE-AUDIT.md`) but do NOT belong to Waves 0–4.
Each entry records the decision so future sessions treat these as decided, not
forgotten. Do not promote an item into a wave without Jameson's word.*

| Item | Decision + why | Date |
|---|---|---|
| **Local MCP server** | Jameson: backlog. The local-first answer to Jump's MCP support — Lantern exposes the advisor's OWN data to THEIR agent tools, locally, nothing leaving the machine. Strategic differentiator; new surface, not in these waves | 2026-07-02 |
| **Client-facing surveys / intake forms** (Jump Pulse & Surveys, AI intake forms) | SKIP standing — requires a client-facing surface we don't have and don't want yet; furthest from the wedge | 2026-07-02 |
| **Outlook add-in (in-inbox assistant)** | DEFER — existing roadmap item; vendor/store applications pending. Jump's shipped (May 2026); Wave 0's save-to-real-Drafts is the near answer | 2026-07-02 |
| **Planning-tool fact write-back** (eMoney/RightCapital/Asset-Map) | DEFER — Jump does this via its Smart Forms (June 2026). Requires partner API relationships we don't hold; recognized-exports remains the read answer | 2026-07-02 |
| **Prep-brief visuals** (portfolio charts, net-worth history) **+ presentation export** | BACKLOG — depends on portfolio-data connectors (Addepar merged but cred-gated); the Workflows engine already exports PowerPoint, so the export half is cheap once data exists | 2026-07-02 |
| **Private-meetings visibility controls (firm tier)** | BACKLOG — Jump mirrors private calendar events with admin-visibility limits. Solo Lantern is private by architecture; the firm-tier variant (hide sensitive meetings from firm admins via key denial) waits for firm-tier demand | 2026-07-02 |
| **Reminders / tickler system** | SKIP — Jump added time-based reminders on contacts/deals/tasks. Our stance: the CRM is the task system (Wave 2 pushes due-dated tasks there); a second reminder engine is inbox sprawl | 2026-07-02 |
| **Practice-wide action-items queue** | **REFUSED** (Jameson, 2026-07-02) — Jump's "Unified Action Items" is a global work queue; Jameson chose per-client only (Wave 3 Task 12b) with the Book view as the sole cross-client attention surface. Do not resurrect silently | 2026-07-02 |
| **Firm-supplied locked keyword lists beyond Task 17d's hook** | BACKLOG — Task 17d reads locked terms from the firm org payload; a full firm compliance-terms workflow (review queues, alerts) is enterprise scope | 2026-07-02 |


## Phase 2 — discovery-driven roadmap (2026-07-02; design briefs now in [`phase-2/`](phase-2/))

Per Jameson (2026-07-02): Phase 1 (Waves 0-4) stands alone and never depends on Phase 2;
each Phase 2 item gets its detailed plan written AFTER Waves 0-4 merge, against the
then-real codebase, per the ritual in [`phase-2/README.md`](phase-2/README.md).

- **Exam-packet assembly** — brief: [`phase-2/exam-binder.md`](phase-2/exam-binder.md) (M).
- **Tax-season pack** — brief: [`phase-2/tax-season-pack.md`](phase-2/tax-season-pack.md) (M).
- **NIGO paperwork pre-validation** — brief: [`phase-2/nigo-pre-validation.md`](phase-2/nigo-pre-validation.md) (M/L; Schwab rules pack first).
- **Reg S-P evidence kit** — brief: [`phase-2/reg-sp-evidence-kit.md`](phase-2/reg-sp-evidence-kit.md) (M; evidence/scoping ONLY, legal-review gate).
- **Test-first items** (held-away parsing, marketing-rule pre-review, diminished-capacity pack) — brief: [`phase-2/test-first-items.md`](phase-2/test-first-items.md); each blocked on its discovery-call validation question.
- **Run the staged discovery-interview campaign** (~/keepance/docs/marketing/campaigns/2026-06-advisor-first-users/) DURING Phase 1 execution — the missing validation instrument; the discovery report is the hypothesis sheet.
- ~~Estate/beneficiary mismatch detection~~ — **moved INTO Wave 4 as Task 2b** (Jameson, 2026-07-02).
