# Lane L1 — APP CHROME + SETTINGS + ONBOARDING (worktree /home/jameson/lp-ux-chrome, branch lp/ux-chrome)

Audit file: `chrome-settings.md` (30 items). Implement all HIGH+MED per common rules. Notes:

- Item 7 (short trust pill): coordinate with foundation — the egress pill unification itself is L0's; you do everything AROUND it (info icon, privacy shortcut, Ctrl+K item 12).
- Item 4 (dedupe privacy/Data Map doors), 5 (flatten Settings nav: left rail becomes the ONLY nav; kill section sub-tabs like AI/MEMORY/PRIVACY), 6 (footer Export/Import/Reset → `...` menu; Reset stays visually dangerous INSIDE the menu), 9 (help-icon reduction) are your core.
- Item 17 + finding F8: the trial chip leaves the status bar unless ≤3 days/expired/action-needed; lives in the account menu otherwise.
- Item 16: remove the duplicate active-file chip in the status bar (keep breadcrumb + Modified).
- Onboarding items 1-3, 26-28: simplify intro/choice, remove decorative orbs/grain background, one AI setup path (Cloud/Local segmented), trim connector logo wall + trust pills, cap example prompts at 4 + disclosure. Finding F9: onboarding intro is SKIPPED under forceOnboarding test flag — verify your intro change by running the true first-run path in the browser (fresh profile / cleared storage), not the flag.
- Also yours (finding F2, small part): the Activity Log surface gets a quiet pass — same patterns (one primary action, flat rows, quiet empty state). Keep it cheap.
- Item 11 old-name sweep: SKIP — the copy lane owns the global rename. Do not touch old-name strings outside files you already edit.
