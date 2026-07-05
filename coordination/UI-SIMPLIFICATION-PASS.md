# UI Simplification Pass — clean up text everywhere (Jameson, 2026-07-05)

**Timing: do the CODE work AFTER the demo is proven** (a broad cross-app change would destabilize the demo + invalidate the running demo test). Safe read-only prep/audit can start in parallel now. This is a post-demo polish phase Jameson already knows he wants ("even when the demo works, I'll want a UI pass").

## The principle
The app must look **extremely clean, intuitive, and easy**. A user should usually understand a section just from its **title (+ icon)**. Today there's too much **gray explanatory subtext** (whole paragraphs) sitting under things by default — Jameson does NOT want any of that gray sub-text showing by default anywhere.

## The rules
1. **Remove gray explanatory subtext everywhere by default.** No paragraphs of gray helper text under cards/sections/settings.
2. **Replace it with a small hover info icon ("i").** The explanation moves INTO a tooltip you get by hovering the little "i" next to the title. Nothing shows until you hover.
   - Need a reusable **InfoIcon / hover-tooltip primitive** (check `src/ui/` for an existing one before building — likely a Radix tooltip already exists). Use it consistently everywhere.
3. **Named example (not the only place — it's everywhere):** Settings → **AI and Privacy** tab → the account cards "On This Computer Only" and "Cloud AI" each have a large paragraph of gray text → move that text behind an "i" hover.
4. **Left-hand CLIENT LIST — two changes (no info icon here):**
   a. It repeats each client's **name underneath in light-gray subtext**, which adds no value → **remove that repeated subtext entirely**; clean up the client rows.
   b. The client list **fills up the whole left bar** → make it **auto-collapse into its own section** (a collapsible section, not an always-expanded list hogging the sidebar).

## Prep started now (safe, read-only — no code changes)
- **Audit**: Codex is inventorying EVERY place the app renders gray explanatory subtext (the muted/secondary paragraph text under titles/cards/settings) → produces the full work-list of spots to convert to info-icons.
- **Component check**: does a reusable info-icon/tooltip primitive already exist in `src/ui/`? (reuse, don't reinvent).
- **Client-list scope**: identify the left-sidebar client-list component + the repeated-name subtext + how to make it a collapsible section.

## Execution plan (AFTER demo proven)
1. Land the InfoIcon/tooltip primitive (or confirm the existing one).
2. Sweep the audited locations: for each, delete the gray paragraph, add an "i" with the text as its hover tooltip. Consistent placement (next to the title).
3. Client list: delete repeated-name subtext; make the list a collapsible auto-collapsing section.
4. LIGHT theme, match existing design system. Gate each batch (tsc + vitest + eslint). Independent review. Screenshots on real Windows so Jameson can eyeball the cleaner look.
