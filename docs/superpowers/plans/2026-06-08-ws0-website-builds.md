# WS0 — Website Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the marketing site's pricing/counts/claims canonical and correct (Phase A0), then build the net-new competitive surfaces — per-vertical comparison sections, six `/vs/` incumbent pages, the `/vs/` hub section, a refreshed hero, and competitive angles on the gatekeeper one-pagers (Phase B) — all folding in the new email wedge, all staged for deploy review (NOT deployed).

**Architecture:** Static HTML under `website/`. No component framework: reuse existing CSS classes (`.vs-card`, `.vs-pricing`, `kp-footer`), clone existing page structure (`website/vs/chatgpt.html` is the `/vs/` template), and reuse the shared nav (`scripts/keepance-nav.v4.js` + `styles/keepance-nav.v2.css`). The verification spine is `tests/unit/website-content-lint.test.ts` (vitest).

**Tech Stack:** Static HTML/CSS, Satoshi font, light theme. Tests: `npx vitest run tests/unit/website-content-lint.test.ts`. Deploy (staging only): `infra/deploy.sh --dry-run`.

---

## Current-state reality (read before touching anything)

- **The 2026-06-04 Tier-1 integrity fixes are ALREADY APPLIED** and locked by lint blocks T1-A/B/D/E/G. Do NOT re-run the tier-1 plan or search for strings like "privilege intact" / "attorney-reviewed" / advisor "in development" — they're gone. Phase A0 only does the residual work below, then verifies the suite stays green.
- **Canonical pricing** (`website/index.html` schema.org + pricing copy, per `PRICING_COHERENCE_RECOMMENDATION_2026-06-01.md` + `2026-06-08-competitive-build-refresh.md` §2): **Personal $49 one-time / Professional $149/yr / Practice $499/yr (annual)**; founding offer = Professional $99/yr for the first 100 buyers per pack. The build-handoff's "$129 / $399 one-time" numbers are STALE — ignore them.
- **Real template counts** (file-count, excluding `index.ts`): **Legal 18, Tax 13, Consulting 9, Advisor 7**. The homepage currently says 10/8/6 and the lint test asserts 10/8/6 — both stale. Re-derive live at execution; packs may have grown again.
- **Honesty:** `@draft` headers still sit in every template source file. Marketing says "built with input from practicing X", NEVER "reviewed by". Stating the real (higher) count is fine; the "reviewed" claim is the landmine. Do not add "reviewed by" anywhere.
- **Email wedge** (v2.5.0): import/storage/search are fully local and unconditional; AI *over* mail depends on model choice (local = nothing leaves; cloud key = prompt goes to provider). Never imply a cloud-key setup keeps mail content local beyond storage/search.
- **Guardrails (every task):** no em dashes; no AI tells (leverage/seamless/empower/unlock/transform your/elevate/delve/tapestry + no "It's not X, it's Y" parallelism); light theme; first-person; reserve privacy absolutes ("nothing leaves your machine") for the local-model path and say "local model" in the same sentence; Heppner = evolving/leading case + "informational, not legal advice" + a source link; competitor pricing = approximate bands + "approximate, as of 2026, check vendor" + outbound link.

---

## Source copy (transcribe, don't reinvent)

- Per-vertical comparison tables + intros + "where the others win" + "why X adds Keepance anyway": `docs/strategy/2026-06-06-competitive-build-handoff.md` §1A (Legal), §1B (Tax), §1C (Consulting), §1D (Advisor).
- `/vs/clio-duo` full page: build-handoff §2B (drafted end-to-end).
- `/vs/` hub section + per-incumbent beats (cocounsel/jump/intuit-assist/gamma/copilot): build-handoff §2 (hub) + the backlog table.
- Email folding (every table gets an email row; `/vs/copilot` gets an email lead row): `2026-06-08-competitive-build-refresh.md` §1.
- Hero shape: refresh §3 — "The AI workspace where your work stays on your machine" + email sub-hook "now including your email, finally searchable and private".
- Competitor pricing bands + where-they-win: `docs/strategy/2026-06-06-vertical-competitive-landscape.md`.

---

# PHASE A0 — Canonical-truth commit (SERIAL, single owner, do FIRST)

> One agent owns this whole phase. It edits `tests/unit/website-content-lint.test.ts`, `website/index.html`, and the four vertical pages — all collision hotspots. It must finish and commit before any Phase B agent starts.

### Task A0.1: Pricing sweep — kill the `$499…one-time` collocation

**Files (inspect each in context; ~20 candidates from grep):**
`website/vs/{chatgpt,claude-projects,cursor-for-writing,heyday,logseq,mem-ai,notion,obsidian,reflect,tana}.html`, `website/blog/{byok-math-for-professionals-2026,keepance-v2-announce,obsidian-vs-keepance,when-your-ai-tool-stops-taking-new-customers,windsurf-cursor-quotas-and-the-end-of-credit-pricing}.html` (+ the `.md` sibling), `website/docs/faq.html`, `website/llms.txt`, `website/local-first-ai-workspace/index.html`, `website/roadmap/index.html`.

- [ ] **Step 1: Inventory.** Run: `grep -rniE '\$?499[^<]{0,30}(one-time|once)|(one-time|once)[^<]{0,30}\$?499' website/` and read each hit in context.
- [ ] **Step 2: Fix.** For a **current price claim** (pricing tables, CTAs, comparison rows), change Practice to **"$499/yr"**. For a **legitimate historical reference** (e.g. a blog post narrating "Practice used to be a single up-front purchase"), reword so `$499` and `one-time`/`once` are NOT within 30 chars of each other and it does not assert current one-time pricing (e.g. "Practice started as a one-time license; it's now $499 a year"). Leave Personal ($49 one-time) untouched — that IS one-time and correct.
- [ ] **Step 3: Verify no collocation remains.** Run the Step-1 grep again; expect zero hits except intentional, reworded historical sentences that no longer collocate.

### Task A0.2: Template counts — atomic HTML + lint-test fix (self-healing)

**Files:** `website/index.html` (homepage pricing card), `website/{legal,tax,consulting,financial-advisors}/index.html` (per-page count claims), `tests/unit/website-content-lint.test.ts` (T1-D block, lines ~222-232).

- [ ] **Step 1: Re-derive live counts.** Run: `for p in legal tax consulting advisors; do echo -n "$p: "; ls src/modules/workflow/templates/$p/*.ts | grep -v '/index.ts' | wc -l; done`
- [ ] **Step 2: Make the lint test self-compute** (so counts never rot again). Replace the three hardcoded `expect(homeHtml).toContain('Legal Practice pack: 10 templates')` lines with a loop that reads each pack dir, counts non-`index.ts` `.ts` files, and asserts the homepage contains `\`${Label} Practice pack: ${count} templates\``. Include Advisor. Map dir→label: `legal`→`Legal`, `tax`→`Tax`, `consulting`→`Consulting`, `advisors`→`Advisor`.

```ts
// T1-D — homepage pricing card reflects ACTUAL template counts (self-computing)
describe('T1-D — homepage pricing card reflects actual template counts', () => {
  it('homepage pricing card reflects actual template counts', async () => {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const homeHtml = await fs.readFile(path.join(WEBSITE_ROOT, 'index.html'), 'utf-8');
    const packs: Array<{ dir: string; label: string }> = [
      { dir: 'legal', label: 'Legal' },
      { dir: 'tax', label: 'Tax' },
      { dir: 'consulting', label: 'Consulting' },
      { dir: 'advisors', label: 'Advisor' },
    ];
    const templatesRoot = path.resolve(WEBSITE_ROOT, '../src/modules/workflow/templates');
    for (const { dir, label } of packs) {
      const files = (await fs.readdir(path.join(templatesRoot, dir))).filter(
        (f) => f.endsWith('.ts') && f !== 'index.ts',
      );
      expect(homeHtml, `${label} count`).toContain(`${label} Practice pack: ${files.length} templates`);
    }
  });
});
```

- [ ] **Step 3: Update the homepage card** so it contains exactly the four strings the test now computes (`Legal Practice pack: 18 templates`, `Tax Practice pack: 13 templates`, `Consulting Practice pack: 9 templates`, `Advisor Practice pack: 7 templates` — use the live numbers from Step 1). If the homepage has no Advisor line in the card, add one consistent with the others.
- [ ] **Step 4: Reconcile the vertical pages.** Grep each vertical page for count claims (`grep -niE '[0-9]+ (workflow )?templates?' website/legal/index.html` etc.) and update to the real pack count, using "built with input from practicing X" framing — never "reviewed by". Keep Advisor honest: it ships live (7 templates), so it is "available", not "in development".

### Task A0.3: Consulting "No upload" precision fix

**File:** `website/consulting/index.html:621-622`

- [ ] **Step 1.** Replace the overclaiming heading/body. The true claim is about the Keepance server, not a blanket "nothing uploaded" (a cloud key still sends the prompt to the provider). Example precise rewrite:

```html
<h3>No Keepance server in the path</h3>
<p>When you run a workflow, the request goes from your machine straight to the AI provider you chose. No Keepance server sees it. Run a local model and nothing leaves your machine at all; use a cloud key and the prompt still goes to that provider, never to us.</p>
```

### Task A0.4: Add the pricing lint guard, verify, commit

**File:** `tests/unit/website-content-lint.test.ts`

- [ ] **Step 1: Add a website-wide pricing collocation guard.** New describe block that walks every `website/**/*.html` (and `.txt`) and asserts no `/\$499[^<]{0,30}(one-time|once)|(one-time|once)[^<]{0,30}\$499/i` match. Use a small recursive readdir helper (mirror `collectBlogPosts`).
- [ ] **Step 2: Run the suite.** Run: `npx vitest run tests/unit/website-content-lint.test.ts` — Expected: PASS (all blocks, including the self-computing T1-D and the new pricing guard).
- [ ] **Step 3: Commit.**

```bash
git add website/ tests/unit/website-content-lint.test.ts
git commit -m "fix(site): canonical pricing sweep + real template counts + consulting privacy precision

- Sweep stale \$499 one-time -> \$499/yr across vs/ + blog + docs (kept legit historical refs)
- Real template counts 18/13/9/7 on homepage + vertical pages; lint self-computes from src
- Consulting 'no upload' -> precise Keepance-server framing (local-vs-cloud)
- Add website-wide pricing-collocation lint guard"
```

---

# PHASE B — Net-new competitive surfaces (parallel after A0 commits)

> File-disjoint tasks can run concurrently. `website/vs/index.html` (B3) and `website/index.html` hero (B4) are single-owner. B5 runs LATE (after WS3 writes the security FAQ). Add every new page to the lint `TARGETS` array so it gets the em-dash/canonical/banned-word sweep.

### Task B1: Per-vertical comparison sections (4 disjoint files)

**Files:** `website/{legal,tax,consulting,financial-advisors}/index.html`

- [ ] For each vertical, insert a "How Keepance compares to the AI you already have" section (after the templates/pack section, before the final CTA). Transcribe the table + intro + "where the others win (honest)" + "why X adds Keepance anyway" from build-handoff §1A/§1B/§1C/§1D. **Add the email row** (refresh §1): Keepance = "Your email, imported and searchable on your machine"; incumbent = how it handles mail (most process it in their cloud). Keep the "with a local model" qualifier verbatim on any "nothing leaves" cell. Footnote every table: "Competitor pricing and features are approximate, as of 2026; check each vendor for current details."
- [ ] Reuse the existing comparison-table / `.vs-card` markup pattern from `website/vs/chatgpt.html`. Light theme, no em dashes.
- [ ] Verify: `npx vitest run tests/unit/website-content-lint.test.ts` stays green; no banned words; canonical tag present on each page (already there).

### Task B2: Six `/vs/` incumbent pages (clone the template)

**Files (create):** `website/vs/{copilot,clio-duo,cocounsel,jump,intuit-assist,gamma}.html`. **Clone source:** `website/vs/chatgpt.html` (read it first for nav + `kp-footer` + verdict/CTA structure + inline-hardcoded canonical pricing).

- [ ] **copilot.html (build FIRST, most weight, net-new copy):** email contrast is the LEAD row (Copilot reads your Outlook in Microsoft's cloud; Keepance imports + searches it locally). Cross-vertical framing. Honest "where Copilot wins" (inside Office, generates real PPTX, no training, already paid for).
- [ ] **clio-duo.html:** transcribe build-handoff §2B end-to-end (H1, intro, "what Clio Duo is genuinely good at", "where Keepance is different", 6-row table, "when to pick Clio Duo instead", "when Keepance is the better fit", "the legal context" with the Heppner citation + source link + "informational, not legal advice", pricing + CTA). Add the email row.
- [ ] **cocounsel / jump / intuit-assist / gamma:** build from the Clio Duo structure, using the per-incumbent beats + where-they-win + wedge + email row from build-handoff §2 and the landscape doc. Each: honest "where they win", the local/zero-egress wedge, email row, approximate-pricing-band footnote + outbound link, light theme, no em dashes.
- [ ] Set `<title>` + meta description + `<link rel="canonical">` per site convention on each (e.g. clio-duo title/meta from build-handoff §2B).
- [ ] **Add all six to `TARGETS`** in `tests/unit/website-content-lint.test.ts` (single serialized edit; coordinate with the phase owner).
- [ ] Verify: lint green on the six new pages.

### Task B3: `/vs/` hub section (single owner of `website/vs/index.html`)

**File:** `website/vs/index.html`

- [ ] Add an "Already using a tool built for your profession?" section with cards linking the six new pages (build-handoff §2 hub copy). Reuse `.vs-card` / `.vs-pricing`. Update the page `<title>`/meta to mention profession tools. Runs AFTER B2 so the link targets exist.
- [ ] Verify: lint green; internal links resolve.

### Task B4: Homepage hero refresh (single owner of `website/index.html` hero block)

**File:** `website/index.html` (hero only — runs AFTER A0 committed the pricing-card edit; do NOT touch the pricing card or JSON-LD `unitText:"ANN"`).

- [ ] Reframe the hero per refresh §3: workspace + local-first core, lead with the local-model zero-egress wedge, email as the headline NEW proof point ("The AI workspace where your work stays on your machine" + sub-hook "now including your email, finally searchable and private"). No em dashes, no AI tells.
- [ ] Verify: lint green; JSON-LD `unitText:"ANN"` on Practice still present.

### Task B5: Gatekeeper one-pager competitive angle (LATE — after WS3 FAQ)

**Files:** `website/one-pagers/{advisor-cco-reg-sp,consulting-client-data-statement,legal-malpractice-carrier,tax-7216-data-handling}.html`

- [ ] Add a short competitive angle to each (how Keepance compares to the incumbent that vertical's gatekeeper will ask about), sourced from the WS3 security FAQ so they don't contradict. Add the missing Heppner source link on `legal-malpractice-carrier.html`.
- [ ] Add the four one-pagers to `TARGETS`. Verify: lint green.

### Task B6: Phase-B verification + commit

- [ ] **Local-vs-cloud co-occurrence guard.** Add a lint block: for each NEW comparison surface (the 6 `/vs/` pages + 4 vertical pages), assert that if the page contains "nothing leaves your machine" it also contains "local model". Run the suite green.
- [ ] **Internal link check.** Extract every `href="/..."` added by Phase B and assert the target file exists under `website/`. Fix any dangling link.
- [ ] **Commit** Phase B in logical chunks (vertical sections; `/vs/` pages + hub; hero; one-pagers) with conventional messages. No deploy.

---

## Self-review checklist (run before handing off)

- [ ] Every comparison states where the competitor genuinely wins; competitor privacy framed as "cloud + contractual no-training", never "they steal your data".
- [ ] Every "nothing leaves your machine" claim co-occurs with "local model"; email rows say import/storage/search are local, AI-over-mail depends on model.
- [ ] Every Heppner mention: evolving/leading case + "informational, not legal advice" + a resolving source link (verify the URL with WebFetch).
- [ ] Pricing: Keepance = $49 one-time / $149/yr / $499/yr everywhere; competitor prices are approximate bands + footnote + link.
- [ ] No em dashes, no banned words, no "It's not X, it's Y"; light theme; every new page has a canonical tag and is in `TARGETS`.
- [ ] `npx vitest run tests/unit/website-content-lint.test.ts` green. Nothing deployed.
