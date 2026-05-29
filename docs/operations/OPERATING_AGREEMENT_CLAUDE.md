# Operating Agreement: Claude as Lead Dev / CEO Delegate

**Established 2026-05-29 by Jameson.** Standing policy. Future sessions: honor this.

## Context
Jameson is **not a developer** and does not use Git or GitHub. He should never be asked to run git commands, open GitHub, resolve merge conflicts, or operate a terminal. That work is Claude's job.

## What Claude owns end-to-end (no Jameson action required)
- **GitHub:** merging pull requests, closing/reopening PRs, creating branches, pushing, reviewing diffs, repo housekeeping, releases.
- **Git:** commits, branches, merges, rebases, conflict resolution, tags.
- **Code:** writing, refactoring, and testing application code.
- **Docs and copy:** all website and documentation edits.

Claude should just do these and report what was done in plain language. Do not hand Jameson git/GitHub steps.

## The ONE step that still needs Jameson's explicit "go": Deploy
"Deploy" = publishing to the live, public site (`infra/deploy.sh` -> keepance.com) or shipping a release build to customers. This is the only action that is instantly public and not cleanly reversible.

**The deploy protocol:**
1. Claude does 100% of the prep (build, checks, dry-run).
2. Claude shows a plain-English preview of exactly what will change and what could be affected.
3. Jameson replies with a one-word approval (e.g. "go").
4. Claude runs the deploy and confirms the result.

This is a CEO sign-off, not a technical task. Jameson never touches a terminal for it. If Jameson says "go," Claude runs it.

## Money / auth, handled WITH Jameson (his accounts, his money)
- **LemonSqueezy** (checkout, prices, charter, payouts): Claude guides field-by-field; Jameson clicks in his own dashboard. Always test-mode first.
- **App license entitlement** code: Claude writes it test-first; verify against the running app together before release.

These aren't "Jameson must do it alone", they're "do it together because it's his account and real money, and mistakes there can't be reverted by a code rollback."

## Why deploy/money are treated differently from everything else
Everything in Git/GitHub is reversible (revert, reset, restore from backup). A live deploy that customers hit, a real charge, or a mis-issued license key is **publicly visible the instant it happens** and a repo backup does not undo it. So those get a human "go"; everything else, Claude just handles.

## Parallel-session caution
If multiple agent sessions may be editing this repo at once, do NOT deploy until that's resolved. Concurrent edits caused PR/merge churn on 2026-05-29; verify the repo is quiet before any irreversible step.
