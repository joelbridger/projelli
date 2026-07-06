# Worker brief — Demo sample workspace (advisor-realistic, on the demo path)

You are **cc-lantern-demoprep**, worktree **~/lp-demoprep**, branch **lp/demo-sample-workspace** (off a4046edd). You do NOT merge; the coordinator merges. Content/tooling lane — no product-code changes.

## Goal
Build the realistic ADVISOR sample workspace the Demo V1 run will open: believable client/household folders with real .docx and .pdf files ALREADY on disk (this is also the test asset for verifying the QA-92 fix: "Ask finds pre-existing files"). Nothing about it may look like test junk on screen.

## What to build (under `docs/demo/sample-workspace/` + a deploy script in `scripts/`)
1. **3 fictional client households** (e.g. "The Hendersons", "Maria & Luis Alvarez", "Dr. Priya Nair"), each a folder containing 4–6 files:
   - Real .docx files (financial plan summary, meeting prep notes, IPS excerpt) — generate with the repo's own docx tooling if convenient, or python-docx/docx templates; must open cleanly in Word/the app.
   - 1–2 small PDFs per client (e.g. a statement summary, a signed-agreement placeholder) — text-based PDFs (not scans) so indexing works without OCR.
   - Content must be plausible, SPECIFIC (named goals, dollar figures, dates in 2025–2026, holdings, RMD questions), 100% fictional, and rich enough that Ask questions like "What did we discuss about the Hendersons' college fund?" have a findable answer.
2. **A demo Q&A crib sheet** `docs/demo/DEMO-QA-CRIB.md`: for each client, 3 questions Jameson can ask in the demo + the expected answer + which file it comes from.
3. **Deploy script** `scripts/deploy-demo-workspace.mjs` (or .ps1) that copies the sample workspace to a target path (used on the Legion/cloud bench). Keep it dead simple.
4. NO binary bloat: keep total under ~5MB. No real personal data. No brand/codename leaks inside documents (no "Keepance", no "lantern" — the firm in the docs is the fictional "Beacon Ridge Wealth Advisors" or similar).

## Done criteria (HARD)
1. Files generated and verifiably valid (docx opens via the repo docx engine test or python-docx round-trip; pdftotext extracts real text from each PDF — show output).
2. Committed AND pushed (`git push -u origin lp/demo-sample-workspace`; `--no-verify` if pre-push fails on unrelated assets — say so).
3. THEN print exactly: `WORKER-DONE: lp/demo-sample-workspace` + 3-line summary.
