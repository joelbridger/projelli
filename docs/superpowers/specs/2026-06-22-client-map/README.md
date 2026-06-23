# Spec — The Client Map (Mission 2)

Net-new feature: a living, structured, source-linked profile of each client/matter that the app builds and maintains from the user's own files and emails. This is **Mission 2** from `../2026-06-18-bottoms-up-wedge/00-START-HERE-situation-and-two-missions.md`. Names are locked by that brief.

Read order:
1. **`01-design-spec.md`** — the approved design (brainstormed with Jameson 2026-06-22, one question at a time). Start here.
2. **`02-implementation-plan.md`** — the task-by-task build plan (13 tasks, Phases A-F), via `superpowers:writing-plans`.

Build method: `superpowers:subagent-driven-development`; implementation subagents on `model: "sonnet"`; Codex for independent review. Ledger: `.superpowers/sdd/progress.md`.

Status (2026-06-23): **v1 BUILT + MERGED to keepance-3.0** (merge 0ec8b8a0). 13 tasks (Phases A-F) via subagent-driven-development + 2 integration fixes. Full gate green; independent Codex review = SHIP (matter isolation + no-silent-cloud-egress confirmed). NOT deployed (no build cut - Jameson's explicit go).

Code: logic in `src/platform/clientMap/` (types, store, provider, completeness, generator, aiSection, customSection, updater, templatesStore, guidedInterview); UI in `src/features/matters/` (ClientMapView, ClientMapUpdatesTray, AddCustomSectionForm, ClientMapTemplates, GuidedInterview, ClientQuestionsList, useClientMap) wired into `MatterHub`.

Known v1 simplifications (intentional, documented, fast-follow candidates - NOT defects):
- Guided Interview answers file under the `standing` section (gap questions carry no per-section target yet).
- A source link opens the Documents/Email surface, not the exact file/chunk (the global launch event has no path argument yet).
- Once a user opts into cloud (BYOK), the map's update-check may call cloud AI when a matter's files change (this is the intended "quietly drafts changes" behavior; never happens on a local-only install; the always-visible egress indicator covers transparency).

Deferred to v2 (per design spec section 5): Firm Philosophy (firm-wide level), the advisor "household" unit, richer sections (timeline, communication style, prior advice).
