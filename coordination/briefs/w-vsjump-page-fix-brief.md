ROLE: Website copy-fix worker. The LIVE public vs-Jump comparison page (keepance.com / advisorprephero.com, source in the main repo's website/ tree) contains factual problems — worst is an apparently FALSE claim crediting Jump with HIPAA compliance (legal/credibility risk when we're positioning against them). You fix the page's falsehoods NOW; the full strategic rewrite happens later (at Wave 3 merge), not in this lane. NOTHING DEPLOYS from this lane — Jameson must personally approve the corrected copy before it goes live (public + competitor-legal).

WORKDIR: ~/kp-vsjump (git worktree off the MAIN repo: created for you with `git -C /home/jameson/kp-coord worktree add -b fix/vs-jump-page /home/jameson/kp-vsjump keepance-3.0`). This is the main product repo (keepance-3.0), not the lantern-plus fork. NOT self-merged; NEVER deploy (do not run infra/deploy.sh).

READ FIRST:
1. ~/lantern-plus/docs/strategy/2026-07-03-jump-battle-plan/08-open-questions-for-jameson.md — Q5 (the finding + recommendation) and 02-kill-sheet.md around line 111 + 06-gtm-attack-plan.md around line 29.
2. ~/lantern-plus/docs/strategy/2026-07-03-jump-battle-plan/SOURCES.md — the cited facts about Jump; every claim on the corrected page must be supportable from these (or newly verified sources you fetch and cite in your handoff).
3. The page source: find it in website/ (grep for Jump). Also check for the same falsehoods on any sibling pages.

FIX EXACTLY (scoped):
- Remove/correct the false HIPAA claim about Jump (state only what SOURCES.md supports; if their real posture is nuanced, say something defensibly precise or drop the row).
- Update the stale advisor count to the sourced current figure (cite in handoff).
- Fix the stale "plain Markdown" copy (the product is Word-native — .docx engine; Markdown never appears in user-facing copy per repo rules).
- Update old "Advisor Prep Hero" branding per current site convention (match what the REST of the live site does today — do not invent a new brand treatment; the single-brand-name decision is an open Jameson question).
- Adjust "isn't a meeting-notes tool" framing minimally so it stays true when Wave 3 (meeting capture) ships — without announcing unshipped features.
- DO NOT add new attack lines, new claims, or restructure the page — falsehood surgery only.

VOICE: match the existing page + the rules in ~/.claude/projects/-home-jameson/memory/feedback_marketing_copy_voice.md (first person, contractions, concrete nouns, no "leverage/seamless/transform", no "It's not X, it's Y"). Never claim SOC 2. Never state a Jump fact without a source.

DELIVERABLE: (1) the corrected page committed on fix/vs-jump-page; (2) a PLAIN-LANGUAGE summary for Jameson at the worktree root JAMESON-REVIEW.md — before/after of each changed claim, why it was wrong, the source for the correction — written so a non-engineer can approve it in 3 minutes.

RULES: COORDINATION MODE (plain-text COORDINATOR: questions, no menus). If the page's build has a local preview command, verify your change renders (screenshot if possible); no deploy. Evidence handoff: HEAD SHA, files touched, claim-by-claim before/after, sources. THEN print your done sentinel for fix/vs-jump-page as the very last line, in the standard worker format.
