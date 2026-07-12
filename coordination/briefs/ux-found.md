# Lane L0 — FOUNDATION (worktree /home/jameson/lp-ux-found, branch lp/ux-found)

You build the shared primitives every other lane reuses. You are the ONLY lane the others wait on — be fast, small, and correct. Design the APIs yourself (deep-module thinking: small interface, obvious defaults).

## 1. Single-source egress (finding F1 — the contradictory trust pills)
- Root-cause why the top-bar `TrustBar` (src/app/shell/layout/TrustBar.tsx) and per-surface `EgressIndicator` mounts can disagree (top bar said "No AI connected" while Ask's header said "Using local AI" simultaneously in browser dev). Unify on ONE store/selector so every consumer renders identical state. Add a unit test that both render paths use the same selector.
- Shorten the top-bar pill to the compact status form (chrome audit #7): `Using local AI` / `Using cloud AI` / `No AI connected`, full provider detail in tooltip.
- REMOVE the passive duplicate EgressIndicator mounts: Ask header (src/features/ask/Ask.tsx ~442-456) and Client Map header (src/features/matters/MatterHub.tsx ~562). Keep handles by moving them onto the top-bar pill if tests grip them; check first.
- Workflow template detail (src/features/workflows/AssociateHome.tsx ~421-435): replace the pill with a TrustNote line above Run (trust at action time — the workflows audit's do-not-touch says visible near Run, and that stands; it just stops being a THIRD copy of the status pill).

## 2. `TrustNote` primitive (synthesis theme 4, the trust ladder)
A tiny component for "one short line at action time": icon + one sentence + optional `details` (tooltip or disclosure for the long explanation). Quiet by default (muted text, no border, no card). Variants only for warning (amber) and blocker (red). Place in src/ui/kp/. Add component tests. Document usage in a short comment header: which ladder level it is for.

## 3. `QuietStatus` primitive (synthesis theme 6)
For normal-good states: renders nothing or a tiny muted check + short text; loud only for failure/blocker (which callers pass explicitly). Used for: saved state, reviewed state, ready cards, "no new changes". Same file conventions as TrustNote.

## 4. Red-usage rule (finding F3)
Sweep src/ui/kp primitives: ensure destructive styling (red) is a deliberate `variant="destructive"`-style opt-in, never the default for links/buttons in lists. Do NOT restyle feature screens (other lanes do that) — just make the primitives make the right thing easy. Add one line to src/ui/kp/README (create if absent): "Accent = selection/primary. Red = destructive/error only, and destructive actions default into row menus."

## Done = the four items above, tests green, branch pushed. Other lanes fetch your branch the moment you push — push as soon as items 2+3 are usable, then finish item 1 and 4 with a second push if needed.
