# Full-screen tab redesign + email sending — plan (2026-06-14)

## Goal (from Jameson, autonomous)
Every shell tab becomes a full-screen, unique, consistently-styled surface (matching Matters/Ask/Email). Plus: real email sending, the held redesign-level simplifications, and rename/restructure. Backup first. **Do NOT deploy** (more refinement rounds to follow).

## Decisions (his questions, my calls)
- **"Your defense file" -> "AI Audit"** (his suggestion; clearer).
- **Trash -> folded into Documents** (a "Trash" view inside Documents, no dedicated tab).
- **Every tab full-page + consistent**; remove the 280px left-panel pattern entirely.
- **Email sending**: build it (Graph/Gmail send + IMAP->SMTP via lettre), with a graceful re-consent flow.

## Backup (done)
- git tag `pre-ui-fullscreen-2026-06-14` + branch `backup/pre-ui-fullscreen-2026-06-14` (pushed).
- tarball `~/keepance-backups/keepance-pre-ui-fullscreen-2026-06-14.tar.gz`.
- working branch `feature/fullscreen-tabs`.

## Surface recipe (reuse from Matters/Ask/Email)
Full-page flex column; eyebrow (10px/700/uppercase/muted) + title (18-22px/800/`--kp-navy`) header; inline styles + brand CSS vars (`--kp-navy`, `--color-*`, `--font-sans`); table/list/card patterns; empty/loading states; self-contained via Zustand stores.

## Workstreams
1. **Foundation** — `ReimaginedSpine.tsx` (remove the 280px panel; nav = Matters/Ask/Documents/Email/Associate/AI Audit; remove Trash item; rename audit label) + `App.tsx` (full-page render branches for files/workflows/audit) + 3 new surface components. The legacy (`?shell=old`) shell is untouched.
2. **Native surfaces** (parallel, git-forbidden subagents):
   - `ReimaginedDocumentsHome` — full-page file browser + full-screen editor + **Trash** view + **simplified context-sensitive toolbar**.
   - `ReimaginedAssociateHome` — full-page **grouped** workflow library (the Associate-grouping simplification).
   - `ReimaginedAuditHome` — full-page audit table + filter + export.
3. **Email sending** — backend (`lettre` dep, `mail_send` per provider, scope upgrade + re-consent event) then UI (compose/reply send in EmailViewer).

## Orchestration (avoid the parallel-git race — see lessons memory)
Commit each verified batch before the next; forbid git in every subagent; parallel only for disjoint files; re-check `git status` after each parallel batch.

## Verification
typecheck 0; full vitest + cargo suites; eslint clean on touched files; Playwright screenshots of every tab full-page (no page errors); brand-CSS stale check after the merge. NOT deployed.

## Held / out of scope this pass (for Jameson's refinement rounds)
In-app send is built; mass features (calendar, contacts) are not. The plan keeps each surface a solid, consistent, working MVP to refine together.
