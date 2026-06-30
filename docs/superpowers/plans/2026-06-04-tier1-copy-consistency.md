# Tier 1 — Integrity and Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every checkable falsehood and internal contradiction on the live site before any outreach or testimonial work begins. All changes are HTML/TypeScript copy edits — no new engineering.

**Architecture:** Seven sequenced workstreams, each ending with a lint-test commit. All changes stay on the `v2-overhaul` branch; deploy requires Jameson's explicit go-ahead.

**Tech Stack:** HTML, TypeScript (template files), Vitest (lint tests). Commands: `npx vitest run tests/unit/website-content-lint.test.ts`, `npm test`.

**Prerequisite decisions:** D1 (advisor pack: ship live), D2 (Practice = $499/yr annual), D3 (soften "reviewed-by" claims). This plan assumes the recommended paths. If decisions differ, see the notes under each task.

---

## Task 1: Soften "reviewed-by" claims (T1-A)

**Files:**
- Modify: `website/legal/index.html` (3 occurrences)
- Modify: `website/tax/index.html` (2 occurrences)
- Modify: `website/consulting/index.html` (3 occurrences)
- Modify: `tests/unit/website-content-lint.test.ts` (add test)

> **If D3 = "hold":** Skip this task. The current copy stays until a named reviewer signs off.

- [ ] **Step 1: Write the failing lint test**

Open `tests/unit/website-content-lint.test.ts` and add after the last `it()` block inside the legal/tax section:

```typescript
it('does not claim attorney/CPA/consultant review has happened', async () => {
  const legalHtml = await fs.readFile(path.join(websiteDir, 'legal/index.html'), 'utf-8');
  const taxHtml = await fs.readFile(path.join(websiteDir, 'tax/index.html'), 'utf-8');
  const consultingHtml = await fs.readFile(path.join(websiteDir, 'consulting/index.html'), 'utf-8');

  const forbidden = [
    'attorney-reviewed and kept current',
    'CPA-reviewed and kept current',
    'reviewed by practicing attorneys',
    'reviewed by practicing consultants',
  ];
  for (const phrase of forbidden) {
    expect(legalHtml).not.toContain(phrase);
    expect(taxHtml).not.toContain(phrase);
    expect(consultingHtml).not.toContain(phrase);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -10
```

Expected: FAIL with at least one assertion about "attorney-reviewed."

- [ ] **Step 3: Edit `website/legal/index.html` — three replacements**

Replace all three occurrences of "attorney-reviewed and kept current":
```
OLD: attorney-reviewed and kept current
NEW: built for attorneys to review and rely on
```

Also replace "reviewed by practicing attorneys and kept current as the law changes":
```
OLD: reviewed by practicing attorneys and kept current as the law changes
NEW: built with attorney input and kept current as the law changes
```

Run: `grep -c "attorney-reviewed\|reviewed by practicing attorneys" website/legal/index.html`
Expected: 0

- [ ] **Step 4: Edit `website/tax/index.html` — two replacements**

```
OLD: CPA-reviewed and kept current
NEW: built for CPAs and EAs to review and rely on
```

Run: `grep -c "CPA-reviewed" website/tax/index.html`
Expected: 0

- [ ] **Step 5: Edit `website/consulting/index.html` — three replacements**

```
OLD: reviewed by practicing consultants and kept current
NEW: built with consultant input and kept current
```

```
OLD: reviewed by practicing consultants; founding-list members get them first at $99/yr
NEW: built with practicing consultants; founding-list members get them first at $99/yr
```

```
OLD: One practice pack (Consulting), reviewed by practicing consultants
NEW: One practice pack (Consulting), built with practicing consultants
```

Run: `grep -c "reviewed by practicing consultants" website/consulting/index.html`
Expected: 0

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add website/legal/index.html website/tax/index.html website/consulting/index.html tests/unit/website-content-lint.test.ts
git commit -m "fix(site/t1-a): soften reviewed-by claims to what is true today"
```

---

## Task 2: Reconcile pricing — EULA, Terms, JSON-LD, $129 sweep (T1-B)

**Files:**
- Modify: `website/legal/eula/index.html` (Practice: one-time perpetual → annual subscription)
- Modify: `website/legal/terms/index.html` (Practice: one-time → annual)
- Modify: `website/index.html` (JSON-LD; Practice pricing card already says $499/yr — verify only)
- Modify: `website/byok-ai/index.html` ($129 → $149, $399 → $499, math recalc)
- Modify: `website/blog/byok-actual-cost-after-60-days.html` ($129 → $149, math recalc)
- Modify: `website/blog/keepance-1-5-announce.html` ($129 → $149, $399 → $499)
- Modify: `website/blog/chat-shouldnt-disappear-when-you-close-the-tab.html` ($129 → $149)
- Modify: `website/blog/how-i-built-keepance-in-8-weeks.html` ($129 → $149, $399 → $499)
- Modify: `website/local-model-setup/index.html` ($129 → $149)
- Modify: `website/markdown-for-ai/index.html` ($129 → $149)
- Modify: `website/api-key-setup-guide/index.html` ($129 → $149)
- Modify: `website/ai-cost-calculator/index.html` ($129 → $149)
- Modify: `website/press-kit/index.html` ($129 → $149, $399 → $499, one-time → annual for Practice)
- Modify: `website/changelog/index.html` ($129 → $149 if in user-facing context)
- Modify: `tests/unit/website-content-lint.test.ts` (add pricing tests)

> **If D2 = different model:** Substitute the confirmed prices. The EULA and Terms must match the checkout exactly.

- [ ] **Step 1: Write the failing lint test**

Add to `tests/unit/website-content-lint.test.ts`:

```typescript
it('EULA and Terms describe Practice as an annual subscription, not one-time perpetual', async () => {
  const eulaHtml = await fs.readFile(path.join(websiteDir, 'legal/eula/index.html'), 'utf-8');
  const termsHtml = await fs.readFile(path.join(websiteDir, 'legal/terms/index.html'), 'utf-8');

  // Should NOT describe Practice as one-time or perpetual
  expect(eulaHtml).not.toMatch(/Practice.{0,60}one-time/i);
  expect(eulaHtml).not.toMatch(/Practice.{0,60}perpetual/i);
  expect(termsHtml).not.toMatch(/Practice.{0,60}one-time/i);

  // Should describe Practice as annual
  expect(eulaHtml).toMatch(/Practice.{0,80}annual/i);
});

it('no stale $129 Professional price in user-facing copy', async () => {
  const files = [
    'byok-ai/index.html',
    'blog/byok-actual-cost-after-60-days.html',
    'blog/keepance-1-5-announce.html',
    'local-model-setup/index.html',
    'markdown-for-ai/index.html',
    'api-key-setup-guide/index.html',
    'press-kit/index.html',
  ];
  for (const f of files) {
    const html = await fs.readFile(path.join(websiteDir, f), 'utf-8');
    // $129 should not appear as a price reference (it's the old Professional price)
    expect(html, `stale $129 in ${f}`).not.toMatch(/\$129\b/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -10
```

Expected: FAIL on EULA perpetual assertion and $129 check.

- [ ] **Step 3: Fix the EULA — `website/legal/eula/index.html`**

Current line ~68:
```
Personal and Practice are granted upon a one-time payment and are perpetual licenses. Professional is an annual subscription...
```
Replace with:
```
Personal is granted upon a one-time payment and is a perpetual license. Professional and Practice are annual subscriptions; the license remains active for the subscription period and must be renewed annually to continue receiving updates and pack maintenance.
```

Current line ~72:
```
<li><strong>Practice ($499 USD, one-time):</strong> A perpetual license for up to 5 seats, including all profession practice packs. Updates and security patches are included for the life of the product.</li>
```
Replace with:
```
<li><strong>Practice ($499 USD/yr, annual subscription):</strong> An annual license for up to 5 seats, including all profession practice packs. Updates, security patches, and pack maintenance are included while the subscription is active.</li>
```

Run: `grep -n "Practice\|perpetual\|one-time" website/legal/eula/index.html | head -10`
Verify: Practice no longer says "one-time" or "perpetual."

- [ ] **Step 4: Fix Terms — `website/legal/terms/index.html`**

Current line ~61:
```
Personal and Practice are one-time purchases (perpetual licenses). Professional is an annual subscription.
```
Replace with:
```
Personal is a one-time purchase (perpetual license). Professional and Practice are annual subscriptions.
```

Current line ~67:
```
<li><strong>Practice ($499, one-time):</strong> A perpetual license for up to 5 seats...
```
Replace with:
```
<li><strong>Practice ($499/yr, annual subscription):</strong> An annual license for up to 5 seats, including all profession practice packs. Pack maintenance and updates are included while the subscription is active.</li>
```

- [ ] **Step 5: Fix JSON-LD in `website/index.html`**

Find the JSON-LD `"offers"` array (line ~36). The Practice offer currently shows `"price":"499"` with no recurrence. Replace the Practice entry with:
```json
{"@type":"Offer","name":"Practice","price":"499","priceCurrency":"USD","priceSpecification":{"@type":"UnitPriceSpecification","price":"499","priceCurrency":"USD","unitText":"ANN"}}
```

- [ ] **Step 6: Sweep $129 → $149 across all 14 files**

For each file, find every `$129` reference in user-facing copy and replace with `$149/yr` (or `$149` when context already has `/yr`). Also replace `$399` with `$499/yr` where Practice is mentioned. Where math is built on $129 (the BYOK cost blog and the cost calculator), recalculate.

**`website/byok-ai/index.html`** (most complex — full math table built on $129):
- Line ~302: `$129` → `$149`
- Line ~303: `$129 + $3-8 = year 1: $165` → `$149 + $3-8 = year 1: $185`
- Line ~304: `$129 + $15-30 = year 1: $309` → `$149 + $15-30 = year 1: $329`
- Line ~529: `$49 Personal / $129 Professional (+ one practice pack) / $399 Practice` → `$49 Personal one-time / $149/yr Professional (+ one practice pack) / $499/yr Practice`

**`website/blog/byok-actual-cost-after-60-days.html`** (three-year savings math):
- Find: `Adding Advisor Prep Hero's $129 Professional tier (paid once) brings my 3-year total to $729`
- Replace: `Adding Advisor Prep Hero's $149/yr Professional tier brings my 3-year total to $447 over three years`
- Update the savings math: $1,800 (subscription stack) - $447 (Advisor Prep Hero 3yr) = $1,353 saved. Update the stated savings figure.

**`website/blog/keepance-1-5-announce.html`**:
- Find: `Professional is $129 and includes one practice pack, and Practice is $399`
- Replace: `Professional is $149/yr and includes one practice pack, and Practice is $499/yr for up to five seats`

**`website/blog/chat-shouldnt-disappear-when-you-close-the-tab.html`**:
- Find: `Professional ($129) adds the practice packs`
- Replace: `Professional ($149/yr) adds the practice packs`

**`website/blog/how-i-built-keepance-in-8-weeks.html`**:
- Find both `$129` and `$399` references; replace with `$149/yr` and `$499/yr`
- Update the `[TBD, fill in after launch]` placeholder — leave as-is for now (it's already marked TBD)

**`website/local-model-setup/index.html`**:
- Find: `Professional (with practice pack) is $129`
- Replace: `Professional (with practice pack) is $149/yr`

**`website/markdown-for-ai/index.html`**:
- Find: `$49 Personal. $129 Professional with practice pack`
- Replace: `$49 Personal one-time. $149/yr Professional with practice pack`

**`website/api-key-setup-guide/index.html`**:
- Find: `Professional (with practice pack) is $129`
- Replace: `Professional (with practice pack) is $149/yr`

**`website/ai-cost-calculator/index.html`**:
- Line ~134: `<option value="129">Professional + practice pack ($129 one-time)</option>`
  → `<option value="149">Professional + practice pack ($149/yr)</option>`
- Line ~224: `Professional (with practice pack) is $129`
  → `Professional (with practice pack) is $149/yr`
- The JavaScript that reads `value="129"` must be updated to match the new value `149`. Search for `129` in the `<script>` block and update any calculation that uses it.

**`website/press-kit/index.html`**:
- Find: `$129 Professional (includes one profession pack) · $399 Practice (up to 5 seats)`
  → `$149/yr Professional (includes one profession pack) · $499/yr Practice (up to 5 seats)`
- Find: `Pricing is one-time: $49 Personal, $129 Professional (includes one profession pack), $399 Practice (up to 5 seats)`
  → `Pricing: $49 Personal (one-time) · $149/yr Professional (includes one profession pack) · $499/yr Practice (up to 5 seats, annual)`

**`website/changelog/index.html`**:
- Find: `3 products: Personal $49, Professional $129, Practice $399`
  → `Personal $49, Professional $149/yr, Practice $499/yr`

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add website/legal/eula/index.html website/legal/terms/index.html website/index.html \
  website/byok-ai/index.html website/blog/byok-actual-cost-after-60-days.html \
  website/blog/keepance-1-5-announce.html "website/blog/chat-shouldnt-disappear-when-you-close-the-tab.html" \
  website/blog/how-i-built-keepance-in-8-weeks.html website/local-model-setup/index.html \
  website/markdown-for-ai/index.html website/api-key-setup-guide/index.html \
  website/ai-cost-calculator/index.html website/press-kit/index.html website/changelog/index.html \
  tests/unit/website-content-lint.test.ts
git commit -m "fix(site/t1-b): reconcile pricing — EULA/Terms Practice annual, $129→$149 sweep"
```

---

## Task 3: Resolve advisor "in development" vs built+live (T1-C)

**Files:**
- Modify: `website/index.html` (advisor card in the "for" section)
- Modify: `website/financial-advisors/index.html` (5 "not shipped" occurrences)
- Modify: `website/financial-advisors/index.html` (add links to /fits-your-stack/ and /local-model-setup/)
- Modify: `src/modules/workflow/index.ts` (no change if D1=A; add build gate if D1=B)

> **If D1 = B (gate out):** Instead of editing the copy to say "available today," remove `...ADVISOR_TEMPLATES` from the spread in `src/modules/workflow/index.ts` and update site copy to say "coming soon" with no date. Skip the "four advisor workflows" language below.

- [ ] **Step 1: Edit `website/index.html` — advisor card**

Find the advisor card in the "for" section (contains "Advisor Practice Pack is in development"):
```html
OLD: The Advisor Practice Pack is in development, shaped with practicing advisors. The local-first workspace is available to download today; the advisor-specific templates are on the way.
NEW: Four advisor workflows built for fiduciary practice: client financial-plan summary, meeting-prep and suitability notes, annual-review packet, and a confidential client-data inventory. Built with practicing advisors; more templates coming.
```

- [ ] **Step 2: Edit `website/financial-advisors/index.html` — resolve the contradiction**

Replace the "in development" section (lines ~564-577) entirely:
```html
OLD:
<h2>The local-first workspace is available today. The advisor-specific templates are on the way.</h2>
<p>The Advisor Practice Pack is in development, shaped with practicing advisors. I am not building it on spec. You will not get templates written by someone who has never run a client review meeting. The local-first workspace you can download right now; the advisor pack ships when it is ready.</p>
...
<p>Based on early conversations with practicing advisors, the pack is planned to include: a client financial-plan summary workflow, meeting-prep and suitability notes, an annual-review packet, and a confidential client-data inventory. These are planned, not yet shipped. Founding-list members will get them first.</p>

NEW:
<h2>Four advisor workflows. Available in the app today.</h2>
<p>The Advisor Practice Pack shipped with four workflows built with practicing advisors: a Client Financial-Plan Summary, Meeting-Prep and Suitability Notes, an Annual-Review Packet, and a Confidential Client-Data Inventory. Each one is designed to produce drafts you review — not advice you rely on without verification. More templates are coming; founding-list members get them first.</p>
<p>The pack is built for practice, not demos. Every template strips account numbers and SSNs from the output by default, frames suitability items as conversation starters rather than determinations, and carries a verify-before-relying banner on outputs that assert regulatory positions.</p>
```

Also add two links near the bottom of the advisor page, in the "what it does not do" or CTA area:
```html
<p>See <a href="/fits-your-stack/">how Advisor Prep Hero fits your current stack</a> and <a href="/local-model-setup/">how to run it with zero data egress using Ollama</a> — the only path that cleanly clears Reg S-P service-provider questions.</p>
```

- [ ] **Step 3: Verify no "in development" / "not shipped" language remains**

```bash
grep -n "in development\|not yet shipped\|on the way\|planned, not yet\|not shipped" website/financial-advisors/index.html
```

Expected: 0 results.

```bash
grep -n "in development\|not yet shipped" website/index.html | grep -i "advisor"
```

Expected: 0 results.

- [ ] **Step 4: Run lint tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add website/index.html website/financial-advisors/index.html
git commit -m "fix(site/t1-c): resolve advisor pack contradiction — built and live, not in development"
```

---

## Task 4: Fix template counts and add hidden template cards (T1-D)

**Files:**
- Modify: `website/index.html` (pricing card counts: 7/7/5 → 10/8/6/4)
- Modify: `website/legal/index.html` (count: 7 → 10; add 3 missing template cards)
- Modify: `website/tax/index.html` (count: 7 → 8; add Notice Response Drafter card)
- Modify: `website/consulting/index.html` (count: 5 → 6; add Statement-of-Work Drafter card)
- Modify: `website/financial-advisors/index.html` (add 4 template cards)
- Modify: all vs-pages that say "15 built in" (find with grep)
- Modify: `tests/unit/website-content-lint.test.ts` (add count assertions)

- [ ] **Step 1: Find all "15 built in" occurrences**

```bash
grep -rn "15 built in\|15 templates" website/ --include="*.html" | grep -v node_modules
```

Note the files returned. Update each to reflect the actual count per pack.

- [ ] **Step 2: Write the failing lint test**

```typescript
it('template counts on pricing card match actual shipped templates', async () => {
  const homeHtml = await fs.readFile(path.join(websiteDir, 'index.html'), 'utf-8');
  // Homepage pricing card should reflect real counts
  expect(homeHtml).toContain('Legal Practice pack: 10 templates');
  expect(homeHtml).toContain('Tax Practice pack: 8 templates');
  expect(homeHtml).toContain('Consulting Practice pack: 6 templates');
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -10
```

Expected: FAIL on count assertions.

- [ ] **Step 4: Update `website/index.html` pricing card**

Find the Professional pricing card list items (currently "7 templates" per pack):
```html
OLD:
<li>Legal Practice pack: 7 templates</li>
<li>Tax Practice pack: 7 templates</li>
<li>Consulting Practice pack: 5 templates</li>

NEW:
<li>Legal Practice pack: 10 templates</li>
<li>Tax Practice pack: 8 templates</li>
<li>Consulting Practice pack: 6 templates</li>
```

Also update the advisor card (which now says "four advisor workflows" per T1-C):
- If the Practice card lists packs, add: `<li>Advisor Practice pack: 4 templates</li>`

- [ ] **Step 5: Update `website/legal/index.html` — count and missing cards**

Replace "7 workflow templates" with "10 workflow templates" in the pack description.

Then add cards for the three templates not yet on the page. Look at the existing template card HTML pattern and add:

```html
<!-- Conflict Check Memo card -->
<div class="template-card">
  <h3>Conflict Check Memo</h3>
  <p>Generates Boolean search strings and a structured parties table for running conflict checks before engagement. Produces a fillable record — the attorney decides whether a conflict exists.</p>
</div>

<!-- Client Risk Assessment card -->
<div class="template-card">
  <h3>Client Risk Assessment</h3>
  <p>Structured intake to identify risk factors before engagement: fee disputes, unrealistic expectations, adverse third parties. Produces a partner-review summary.</p>
</div>
```

(Adapt the card HTML structure to match the existing card pattern on the legal page.)

- [ ] **Step 6: Update `website/tax/index.html` — count and Notice Response Drafter**

Replace "7 workflow templates" with "8 workflow templates."

Add the Notice Response Drafter card:
```html
<div class="template-card">
  <h3>Notice Response Drafter</h3>
  <p>Drafts responses to IRS CP2000, CP2501, and Letter 525 underreporter inquiries. Structures the response with client facts, requested adjustments, and supporting document checklist. You verify the legal positions before sending.</p>
</div>
```

- [ ] **Step 7: Update `website/consulting/index.html` — count and SOW Drafter**

Replace "5 templates" with "6 templates."

Add the Statement-of-Work Drafter card — with the honest framing from the review (paste-your-own-clauses instead of auto-generated contract language):
```html
<div class="template-card">
  <h3>Statement-of-Work Drafter</h3>
  <p>Structures a SOW from discovery notes: scope, deliverables, timeline, assumptions, exclusions. Leaves the legal clauses (confidentiality, IP, liability) as labeled placeholders for your lawyer-approved language.</p>
</div>
```

- [ ] **Step 8: Fix "15 built in" on all vs-pages**

For each vs-page found in Step 1, update "15 built in" to the correct pack count for that context, or remove the claim if it refers to a single pack.

- [ ] **Step 9: Run lint tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add website/index.html website/legal/index.html website/tax/index.html \
  website/consulting/index.html website/financial-advisors/index.html \
  tests/unit/website-content-lint.test.ts
# Add any vs-pages modified
git commit -m "fix(site/t1-d): correct template counts (10/8/6/4), add missing template cards"
```

---

## Task 5: Fix privacy headline overclaims (T1-E)

**Files:**
- Modify: `website/legal/index.html` ("privilege intact" headline and hero)
- Modify: `website/tax/index.html` ("eliminates the AI-transmission risk," "simplifies all three," ABA 512)
- Modify: `website/consulting/index.html` ("sidesteps the clause entirely," "there is no upload")
- Modify: `website/index.html` (homepage trust bar — ABA 512, "simplifies all three")
- Modify: `tests/unit/website-content-lint.test.ts` (add forbidden-phrase assertions)

**Model to copy:** The advisor page (`/financial-advisors/`) has the correct local-vs-cloud distinction. Use it as the template.

- [ ] **Step 1: Write the failing lint test**

```typescript
it('no overclaimed privacy/privilege absolutes on vertical pages', async () => {
  const legalHtml = await fs.readFile(path.join(websiteDir, 'legal/index.html'), 'utf-8');
  const taxHtml = await fs.readFile(path.join(websiteDir, 'tax/index.html'), 'utf-8');
  const consultingHtml = await fs.readFile(path.join(websiteDir, 'consulting/index.html'), 'utf-8');
  const homeHtml = await fs.readFile(path.join(websiteDir, 'index.html'), 'utf-8');

  const forbidden = [
    'keeps attorney-client privilege intact',
    'Privilege-safe by design',
    'eliminates the AI-transmission risk',
    'sidesteps the clause entirely',
    "there's no upload",
    'built for ABA Opinion 512 duties',
    'simplifies all three',
  ];
  for (const phrase of forbidden) {
    expect(legalHtml, phrase).not.toContain(phrase);
    expect(taxHtml, phrase).not.toContain(phrase);
    expect(consultingHtml, phrase).not.toContain(phrase);
    expect(homeHtml, phrase).not.toContain(phrase);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Fix `website/legal/index.html` — privilege claims**

Find and replace the hero headline:
```
OLD: Privilege-safe by design / keeps attorney-client privilege intact
NEW: Built for the confidentiality standard your clients expect
```

Find any sub-copy that says "keeps privilege intact" or makes an absolute privilege claim. Replace with precise language:
```
OLD: keeps attorney-client privilege intact
NEW: is structured so the attorney's files never pass through a third-party server — supporting the confidentiality analysis under Heppner and ABA Opinion 512. With a cloud AI key, your prompts go to that provider directly; with a local model, nothing leaves your machine.
```

Standardize ABA 512 framing to match the legal page's own careful card:
```
OLD: built for ABA Opinion 512 duties
NEW: aligns with ABA Opinion 512's confidentiality analysis
```

- [ ] **Step 4: Fix `website/tax/index.html` — transmission and Safeguards claims**

```
OLD: Local-first eliminates the AI-transmission risk
NEW: Local-first means Advisor Prep Hero's servers are never in the path. With a cloud AI key, your prompts go to that provider — which is a Section 7216 disclosure; that is exactly why the pack includes the Section 7216 consent template. A local Ollama model is the only path that removes the disclosure entirely.
```

```
OLD: simplifies all three [Section 6713 / 7216 / Safeguards]
NEW: removes Advisor Prep Hero as a third-party recipient under Section 6713 and 7216; pair it with the Section 7216 consent template for cloud use. The Safeguards Rule's WISP, risk-assessment, and incident-response obligations are separate — we do not satisfy them for you, but the data-path audit log supports your documentation.
```

```
OLD: No small-practitioner exemption
NEW: The Safeguards Rule applies to tax preparers who maintain client financial data regardless of firm size (though specific program requirements scale; confirm with your compliance advisor)
```

- [ ] **Step 5: Fix `website/consulting/index.html` — NDA clause claims**

```
OLD: sidesteps the clause entirely / there's no upload
NEW: With a local Ollama model, nothing goes to any AI provider — the only path that cleanly satisfies an explicit no-AI-upload clause. With a cloud API key, prompts go directly to your provider; that is technically an upload to an AI service, and you should read your NDA's definition before relying on it. The data-path page explains both paths in plain English.
```

- [ ] **Step 6: Run lint tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add website/legal/index.html website/tax/index.html website/consulting/index.html \
  website/index.html tests/unit/website-content-lint.test.ts
git commit -m "fix(site/t1-e): replace privacy overclaims with accurate local-vs-cloud framing"
```

---

## Task 6: Cite Heppner properly and link it (T1-F)

**Files** (7 files with Heppner mentions):
- Modify: `website/ai-workspace-privacy/index.html`
- Modify: `website/blog/byok-math-for-professionals-2026.html`
- Modify: `website/blog/local-client-cloud-brain-whats-actually-open-in-ai-tools.html`
- Modify: `website/blog/windsurf-cursor-quotas-and-the-end-of-credit-pricing.html`
- Modify: `website/index.html`
- Modify: `website/legal/index.html`
- Modify: `website/local-first-ai-workspace/index.html`

**Correct citation:** United States v. Heppner, S.D.N.Y. (Judge Rakoff, Feb. 17, 2026)

**Link target:** Use the Harvard Law Review note URL (web-verified by the review). Find the actual URL by searching "Heppner SDNY Harvard Law Review 2026" — it should be at jolt.law.harvard.edu or harvardlawreview.org. If that specific URL is not confirmed, link to the Gibson Dunn or Paul Weiss client alert, which is reliably public.

- [ ] **Step 1: Find all Heppner references**

```bash
grep -n "Heppner" website/ai-workspace-privacy/index.html website/index.html website/legal/index.html
```

Note the exact current text in each file.

- [ ] **Step 2: Confirm the correct link**

Verify one of these URLs works:
- `https://harvardlawreview.org` — search for Heppner
- `https://www.gibsondunn.com` — search for Heppner AI privilege
- Use `curl -sI <url> | head -5` to confirm it resolves.

Pick one reliably permanent URL (a major law firm client alert is more stable than a blog).

- [ ] **Step 3: Update all 7 files**

In each file, find the Heppner citation and replace:
```
OLD: U.S. v. Heppner (S.D.N.Y. Feb. 2026)
NEW: <a href="[CONFIRMED_URL]" target="_blank" rel="noopener"><em>United States v. Heppner</em></a> (Judge Rakoff, S.D.N.Y., Feb. 17, 2026)
```

Where the sentence currently reads something like "keeping your work out of third-party AI may preserve privilege (Heppner)," update to make the Heppner point stronger per the review's framing:

```
"A federal court held in February 2026 that documents generated via Anthropic's Claude were not protected by attorney-client privilege because transmitting them to a third-party AI platform destroyed confidentiality (<a href="[CONFIRMED_URL]" target="_blank" rel="noopener"><em>United States v. Heppner</em></a>, Judge Rakoff, S.D.N.Y., Feb. 17, 2026). That reasoning applies to any third-party transmission — including a cloud BYOK key. A local model is the only path that removes the exposure entirely."
```

Adapt the surrounding sentence to keep the voice natural.

- [ ] **Step 4: Verify no bare citations remain**

```bash
grep -rn "Heppner" website/ --include="*.html" | grep -v "Judge Rakoff\|February 17"
```

Expected: 0 results (all should now have the full citation).

- [ ] **Step 5: Run lint tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add website/ai-workspace-privacy/index.html website/blog/byok-math-for-professionals-2026.html \
  website/blog/local-client-cloud-brain-whats-actually-open-in-ai-tools.html \
  website/blog/windsurf-cursor-quotas-and-the-end-of-credit-pricing.html \
  website/index.html website/legal/index.html website/local-first-ai-workspace/index.html
git commit -m "fix(site/t1-f): cite Heppner properly with judge, date, and link in all 7 files"
```

---

## Task 7: Rewrite stale /tour/ page (T1-G)

**Files:**
- Modify: `website/tour/index.html`
- Modify: `tests/unit/website-content-lint.test.ts` (add /tour/ assertions)

- [ ] **Step 1: Write the failing lint test**

```typescript
it('/tour/ page does not use forbidden words or stale content', async () => {
  const tourHtml = await fs.readFile(path.join(websiteDir, 'tour/index.html'), 'utf-8');

  expect(tourHtml).not.toContain('compliant');
  expect(tourHtml).not.toContain('Advisor Prep Hero ensures');
  expect(tourHtml).not.toContain('two templates');
  expect(tourHtml).not.toContain('tax-practice'); // dead URL
  // Should reflect real pack size
  expect(tourHtml).toContain('eight');  // or "8" — the real tax template count
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -10
```

Expected: FAIL on "compliant," "two templates," and "tax-practice."

- [ ] **Step 3: Rewrite the tax section of `/tour/`**

Find the tax section (references "two templates," "compliant," `href="/tax-practice/"`).

Replace with:
```html
<h3>Tax Practice — 8 workflows for CPAs and EAs</h3>
<p>The Tax Practice Pack includes eight workflows built for the documents tax professionals actually produce. The Section 7216 Engagement Packet generates per-use consent forms that meet the 12-point-type and separate-document requirements. The Notice Response Drafter structures CP2000 and CP2501 responses with client facts and document checklists — you verify the legal positions before sending. The Audit Defense File Builder, Tax Research Memo, and Quarterly Estimate Reminder all carry a verify-before-relying banner, because this is regulated output.</p>
<p>A local Ollama model means your client data never reaches any AI provider — the strongest answer to a Section 7216 disclosure analysis. With a cloud key, the pack includes the consent template to handle it properly.</p>
<p><a href="/tax/">See the full Tax Practice Pack →</a></p>
```

- [ ] **Step 4: Remove "compliant" and "ensures" from the entire /tour/ page**

```bash
grep -n "compliant\|ensures\|Advisor Prep Hero ensures" website/tour/index.html
```

For each match, rewrite to remove the overclaim. Replace with precise language about what Advisor Prep Hero produces vs what the professional decides.

- [ ] **Step 5: Fix dead link**

```bash
grep -n "tax-practice" website/tour/index.html
```

Replace any `href="/tax-practice/"` with `href="/tax/"`.

- [ ] **Step 6: Run lint tests**

```bash
npx vitest run tests/unit/website-content-lint.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 7: Final full test run**

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ tests pass.

- [ ] **Step 8: Commit**

```bash
git add website/tour/index.html tests/unit/website-content-lint.test.ts
git commit -m "fix(site/t1-g): rewrite stale /tour/ tax section — real count, no overclaims, fix dead link"
```

---

## Final Tier 1 deploy gate

After all 7 tasks are committed and tests pass, report to Jameson:

- All 7 Tier 1 integrity fixes are committed on `v2-overhaul`
- `npm test` passes
- Ready for deploy to keepance.com (`infra/deploy.sh`)
- Do NOT deploy autonomously — wait for explicit go

Then move to `docs/superpowers/plans/2026-06-04-tier2-trust-builds.md`.
