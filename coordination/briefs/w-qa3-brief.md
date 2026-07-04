# Explorer brief — QA campaign lane 3: "the edge-case hunter" (persona D, browser build)

**Lane:** cc-lantern-qa3 · dir `~/lp-qa3` (your OWN worktree, branch `lp/qa-persona-d`). **Model:** Sonnet 5 · high.
**Read first:** `coordination/QA-CAMPAIGN.md` (rules, severity scale, the edge-case catalog — you work THAT list) + existing findings in `coordination/qa-campaign/BUG-DB.md` (QA-1..12 known; don't re-file). You are an EXPLORER: find and report, never fix product code.

## Seat
The server's **browser dev build** — `npm run dev` in YOUR worktree on a free port (`--port`, strictPort; NEVER assume :5173 is yours — other lanes run vite too). Drive it with the always-on Chrome (`chrome-cdp session create qa3 …`) or Playwright. No VM, no Legion, no bench — your whole world is the browser build. Note honestly in each finding that the seat is the browser build (WebFS backend, no Tauri) — flag anything that might behave differently on desktop for a bench re-check rather than over-claiming.

## Mission
Systematically abuse the app through the edge-case catalog, prioritizing what the browser seat can genuinely test: zero-byte files; huge files; filenames with emoji/unicode/reserved Windows names (CON, trailing dots — how does the WEB build handle them?); an EMPTY workspace (every surface: Ask, Client Map, Meetings, Email tabs with nothing in them); a 500-client workspace (script the setup; watch performance + UI degradation); non-English content and the de/es locales; rapid reload mid-index; two tabs of the app at once on the same workspace; absurd inputs everywhere (10k-char client name, HTML/script tags in names — note any rendering weirdness as a finding, including anything that looks like injection); back-button abuse; deep-link/URL manipulation if routes exist. Extend the catalog with what you discover — you're the systematic one.

## Reporting
Append findings to `coordination/qa-campaign/BUG-DB.md` continuing the ID sequence (coordinate: qa2 is also appending — take the next free ID at commit time and rebase-resolve conflicts in YOUR lane), severity + repro + evidence (`coordination/qa-campaign/evidence/qa3-20260704/`). Record what held up well. Plain-language summary (Jameson reads it). Commit on YOUR branch in YOUR worktree (`git branch --show-current` first — must say `lp/qa-persona-d`), push, kill your dev server, then the last line exactly: `WORKER-DONE: qa3`

## Landmines
Never fix product code. Never touch the Legion or the Azure VMs. Don't kill vite processes you didn't start. No interactive menus — blocking decisions as plain text `COORDINATOR:` lines.
