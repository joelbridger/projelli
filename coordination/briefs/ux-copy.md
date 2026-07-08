# Lane L8 — GLOBAL COPY SWEEP + ALL CLIENTS (worktree /home/jameson/lp-ux-copy, branch lp/ux-copy)

No single audit file — your spec is FABLE-ENHANCED.md items F2/F4/F7/C4 + synthesis theme 7. You run LAST in merge order, so expect the coordinator to ask for a rebase; keep commits clean.

## 1. The great rename (C4)
- Replace every user-visible `Advisor Prep Hero` with `Lantern` (62 in en.json, 10 in src/features/onboarding/v2/copy.ts, plus any others you grep). Where the name is redundant nearby, prefer `this app` per the audit rewrites. Do NOT touch: code identifiers, file paths, tests asserting internal names, the `matter` facade, or docs/.
- The top-left brand asset still renders the old mascot + wordmark (finding C4): swap to the Lantern mark. Look in src/ui/brand/ and the TrustBar/App header for the logo component; if no Lantern asset exists in-repo, note it in your done file as NEED-ASSET and leave the component keyed for a one-file swap.

## 2. All Clients home (F2) — `src/features/matters/MattersHome.tsx`
- The five always-visible per-row quick actions (Ask/Documents/Email/Meetings/Activity) collapse to: row click opens the client (Client Map), one `...` row menu holds the rest. Keep handles.
- Kill the dead `Click a client on the left` pane: when clients exist and none is selected, the right pane shows the All Clients table itself (or auto-selects All Clients). Cheapest correct behavior wins.
- Get-started steps (empty state) keep max ONE primary action.

## 3. Client rail labels (F4) — `src/app/shell/layout/Spine.tsx` + matterLabel
- Rail shows the display name only (`The Brennan Household`), no ` - Suffix` duplication; full label in tooltip. Don't change stored data — presentation only.

## 4. Global copy hygiene (theme 7)
- en.json sweep: remove ellipses from placeholders, sentence-case labels, apply the schema-label rewrites from chrome-settings.md item 30, fix plural forms where counts interpolate (F7).
- Do NOT restyle components — copy and MattersHome/Spine only. Other lanes own their screens' strings; skip any string their audit already rewrites (grep the audit files when unsure; when you can't tell, leave it and list it in your done file).
- Refresh `tests/unit/i18n/en-json-snapshot.test.ts` honestly at the end (true count + comment).
