# Lantern app worker guide

This checkout is the canonical Lantern desktop app. Lantern V1 is a proven
Windows product for financial-advisor firms: it fully replaces Wealthbox CRM
and Jump meeting work while becoming the trusted, source-linked client
intelligence center.

## Start with the coordination truth

The coordination repository at `/home/jameson/lantern/coordination` owns
product truth and worker policy. Read and follow its root `AGENTS.md`,
`CURRENT.md`, `PLAN.md`, and `V1-SCOPE.md`, plus
`coordinator/NON-NEGOTIABLES.md` and `coordinator/AI-OPERATING-MODEL.md`.
Do not copy or reinterpret that operating playbook here; it changes there.

## Your worker boundary

- Do not spawn workers or notify Jameson.
- Change only the files owned by your written contract. Report results upward.
- Do not merge, push integration branches, publish, release, or deploy.
- The coordinator's launch contract may authorize pushing your own worker
  branch for intake; follow that exact authorization when it is present.

## Product guardrails

- Reuse the current encrypted core. Build no second CRM foundation, no new
  store or backend, and no duplicate source of client truth.
- Do not invent another app shell or design system. Extend the existing system
  and keep the interface light, clear, and accessible.
- Keep the selected client persistent across CRM, Meetings, and Ask.
- Keep Whole Firm closed until staff permissions exist.
- Important official changes and every outside send require human approval.
- Cite the source material behind client intelligence, summaries, and answers.

## App map and verification

- Read `ARCHITECTURE.md` before structural work. It maps the feature-first
  app, the dependency rules, shared platform services, and UI system.
- Use the relevant README in the changed feature or test area. For product
  behavior, start with `tests/acceptance/README.md`; desktop checks live in
  `tests/desktop/README.md`.
- Run tests in proportion to the changed area. Common checks are
  `npm run typecheck`, focused `npx vitest run ...`, and the appropriate
  acceptance or desktop command. A claim is not done without recorded evidence.

Keep changes small, preserve existing contracts, and leave the branch clean for
the coordinator to review.
