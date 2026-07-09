# Schwab Account-Opening — Implementation Plan (approved 2026-07-09)

**Status:** APPROVED by Jameson 2026-07-09 — build the prefill half now; start the partner clock in parallel.
**Branch:** `feat/schwab-prefill` (worktree `~/lp-schwab-prefill`, off `lp/ux-simplify-v1`).
**Research:** `coordination/reports/schwab-integration-research.md` + `schwab-creative-paths.md` (in progress).

## The two tracks
### Track 1 — Prefill-the-paperwork (BUILD NOW, no Schwab permission)
After a client meeting, the advisor picks account types (IRA / Roth / Rollover IRA / Joint / Living Trust / Inherited IRA / Custodial…), and Advisor Prep Hero produces a **filled, ready-to-sign Schwab account application** — delivered as a PDF and/or a DocuSign envelope — prefilled from the meeting facts + CRM.

**What exists to build on:**
- Document engine (`lantern-docx` crate) — generates real documents today.
- DocuSign connector (`src/features/docusign/`).
- Wealthbox CRM data (`src/features/crm/`) — client/household fields.
- Workflows engine + `InterviewForm` — structured capture + the run pipeline.
- Meeting summaries/transcripts — structured facts to prefill from.

**Build shape:**
1. **Account-application templates** — model Schwab's official application PDFs as fillable field maps (IRA/Roth/Joint/Trust/Custodial). Source the current public Schwab forms (see research).
2. **Prefill mapping** — map meeting/CRM fields → form fields (name, DOB, SSN placeholder, address, beneficiaries, funding source). Advisor reviews/edits every field; nothing auto-submits.
3. **Delivery** — (a) filled PDF download, (b) DocuSign envelope to the client for e-sign. Reuse the existing docx/PDF + DocuSign paths.
4. **A "New account" workflow** in Workflows: pick account type(s) → confirm prefilled fields → choose delivery. Client-scoped, audited, review-gated (matches the app's consent model).

**Invariants:** no SSN stored in plaintext; advisor reviews before any send; audited; client-scoped isolation; local-first.

### Track 2 — The Schwab partnership (start the clock; ~1 year)
The "click inside our app → opens at Schwab" magic is Schwab's **Digital Account Opening (DAO)** behind their approved-partner program (supports the account types; up to 50 prefilled data points; `eAuthorization` for client approval). Getting approved is relationship + security + legal work, not code.

**What I'll prepare (drafts, for Jameson to submit):**
- `docs/partnerships/schwab-partner-application-draft.md` — the integration proposal / application narrative.
- `docs/partnerships/schwab-security-posture.md` — our security story (local-first, BYOK, E2EE relay, SOC 2 readiness, data handling) — the bar Schwab vets against.
- A contact/next-steps checklist (who at Schwab Advisor Services, what to ask for).

This is a **Jameson + business** task (his relationship, his signature); I prepare the materials so applying is fast.

### Track 3 — Clever paths around the locked door (research in flight)
`schwab-creative-paths.md` (Codex research running) is ranking: Schwab's public Trader/Developer API (post-TDA), account aggregation (Plaid/Akoya/ByAllAccounts) for Schwab *data* with client consent + no partnership, deep-link/URL-prefill handoff into Schwab's own DAO, and how competitors actually connect. Deliverable: a ranked "start here" list. This may surface a faster path than the full partnership.

## Sequence
1. Build Track 1 (prefill) now — real competitive feature, ships without anyone's permission.
2. I draft Track 2 materials in parallel (writing, not code).
3. Track 3 research lands → we pick any fast wins (e.g. aggregation read, deep-link handoff).
