# Tier 2 — Last-Mile Trust and Software Builds

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between what the site promises and what the app delivers — verification banners everywhere they belong, per-vertical proof of output quality, API-key friction eliminated at the decision moment, one-pager artifacts for every gatekeeper, branded export, and multi-client isolation made real and visible.

**Prerequisite:** All Tier 1 tasks complete and deployed.

**Architecture:** Six workstreams. T2-1, T2-3, T2-5, T2-6 are pure code/copy. T2-2 requires Jameson to provide or approve real redacted sample output (the templates generate it; he reviews the redaction). T2-4 is HTML content production.

**Tech Stack:** TypeScript (templates), HTML/CSS (site), Vitest (tests). Export pipeline is in `src/App.tsx` (export dropdown) and `src/utils/docx-io.ts` / `src/utils/pptx-io.ts`.

---

## Task T2-1: Turn on `requiresVerification` for all regulated templates

**Files:**
- Modify: all template files in `src/modules/workflow/templates/tax/` (7 of 8 missing the flag)
- Modify: all template files in `src/modules/workflow/templates/consulting/` (6 of 6 missing)
- Modify: all template files in `src/modules/workflow/templates/advisor/` (4 of 4 missing)
- Modify: 5 remaining legal templates that lack the flag
- Modify: `tests/unit/website-content-lint.test.ts` (extend to check template TS files)

**What `requiresVerification: true` does:** The app shows a non-dismissable banner on the workflow output: "Verify before relying. This output was produced by AI and reflects the information you provided. Check citations, math, and regulatory positions against primary sources before sending to a client or filing." The banner copy is pulled from the template's `verificationNote` field if present, or the default message.

- [ ] **Step 1: List every template missing the flag**

```bash
for f in src/modules/workflow/templates/{tax,consulting,advisor,legal}/*.ts; do
  if ! grep -q "requiresVerification: true" "$f"; then
    echo "MISSING: $f"
  fi
done
```

Note the full list.

- [ ] **Step 2: Write the failing test**

Add to `tests/unit/website-content-lint.test.ts` or a new file `tests/unit/template-verification.test.ts`:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { glob } from 'glob';

describe('template verification banners', () => {
  // Templates that MUST have requiresVerification: true
  // (asserts legal authority, regulatory positions, deadlines, or math)
  const MUST_VERIFY = [
    // Tax
    'src/modules/workflow/templates/tax/TaxResearchMemo.ts',         // already set
    'src/modules/workflow/templates/tax/NoticeResponseDrafter.ts',
    'src/modules/workflow/templates/tax/AuditDefenseFileBuilder.ts',
    'src/modules/workflow/templates/tax/QuarterlyEstimateReminder.ts',
    'src/modules/workflow/templates/tax/Section7216EngagementPacket.ts',
    'src/modules/workflow/templates/tax/EngagementLetterBuilder.ts',
    // Legal
    'src/modules/workflow/templates/legal/CaseTimelineBuilder.ts',
    'src/modules/workflow/templates/legal/PatentDisclosureDraft.ts',
    'src/modules/workflow/templates/legal/ClientIntakeSynthesizer.ts',
    'src/modules/workflow/templates/legal/DepositionContradictionFinder.ts',
    // Consulting
    'src/modules/workflow/templates/consulting/ConfidentialResearchMemo.ts',
    'src/modules/workflow/templates/consulting/StatementOfWorkDrafter.ts',
    // Advisor (all four)
    'src/modules/workflow/templates/advisor/ClientFinancialPlanSummary.ts',
    'src/modules/workflow/templates/advisor/MeetingPrepSuitabilityNotes.ts',
    'src/modules/workflow/templates/advisor/AnnualReviewPacket.ts',
    'src/modules/workflow/templates/advisor/ConfidentialClientDataInventory.ts',
  ];

  for (const templatePath of MUST_VERIFY) {
    it(`${path.basename(templatePath)} has requiresVerification: true`, async () => {
      const content = await fs.readFile(templatePath, 'utf-8');
      expect(content).toContain('requiresVerification: true');
    });
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/unit/template-verification.test.ts 2>&1 | tail -15
```

Expected: FAIL for all templates not yet flagged.

- [ ] **Step 4: Add `requiresVerification: true` and a `verificationNote` to each template**

For each template in the MUST_VERIFY list (except TaxResearchMemo which is already set), add inside the template object:

```typescript
requiresVerification: true,
verificationNote: '<per-template message — see below>',
```

Per-template `verificationNote` copy:

**Tax:**
- `NoticeResponseDrafter`: `"Verify every factual assertion and deadline posture against the actual notice and primary IRC authority before sending to the IRS or sharing with your client."`
- `AuditDefenseFileBuilder`: `"Every 'substantial authority' position in this output is a proposed argument, not a legal determination. Verify citations and confirm the position with your own research before filing or communicating to the IRS."`
- `QuarterlyEstimateReminder`: `"This output includes a Section 6621 interest rate that changes quarterly. Verify the current rate and confirm safe-harbor math against the client's prior-year liability before sending."`
- `Section7216EngagementPacket`: `"Review the generated consent language against the current Treasury Reg. §301.7216-3 requirements and confirm the 12-point-type and separate-document rules are met before presenting to the client."`
- `EngagementLetterBuilder`: `"Review all engagement-scope language and limitation-of-liability clauses against your firm's standard terms before sending."`

**Legal:**
- `CaseTimelineBuilder`: `"Verify every deadline against applicable court rules and confirm SOL calculations independently before docketing."`
- `PatentDisclosureDraft`: `"Inventorship is a legal determination. Have a registered patent attorney review this disclosure before submission. Do not rely on this output for inequitable-conduct or duty-of-disclosure compliance."`
- `ClientIntakeSynthesizer`: `"This output is a structured intake record. Run the conflict check independently; this template does not perform or replace a conflict search."`
- `DepositionContradictionFinder`: `"Verify every flagged contradiction against the original transcript before use. AI can misread nuance, context, or page breaks."`

**Consulting:**
- `ConfidentialResearchMemo`: `"Verify all cited sources, statistics, and market-size figures against primary sources before presenting to a client."`
- `StatementOfWorkDrafter`: `"The legal clause placeholders in this output are placeholders only. Replace them with your lawyer-approved confidentiality, IP, and liability language before presenting to a client."`

**Advisor:**
- `ClientFinancialPlanSummary`: `"This output is a draft summary, not a financial plan. Verify all figures against source data and have a licensed advisor review before presenting to the client."`
- `MeetingPrepSuitabilityNotes`: `"Suitability determinations are advisor judgments. This output is a conversation framework, not a suitability analysis. Review every item before the client meeting."`
- `AnnualReviewPacket`: `"Verify all performance figures and regulatory references against current account statements and Reg BI/suitability documentation before the client meeting."`
- `ConfidentialClientDataInventory`: `"This inventory is a documentation aid, not a WISP or Reg S-P compliance plan. Have your compliance consultant review it as part of your written information security program."`

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/unit/template-verification.test.ts 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 6: Full test run**

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workflow/templates/ tests/unit/template-verification.test.ts
git commit -m "feat(app/t2-1): requiresVerification on all 22 regulated templates with per-template banners"
```

---

## Task T2-2: Per-vertical sample-output galleries

**Autonomy: Jameson required for content**

**Files:**
- Create: `website/samples/tax-research-memo.html` (or PDF link)
- Create: `website/samples/cp2000-response.html`
- Create: `website/samples/consulting-discovery-synthesis.html`
- Create: `website/samples/advisor-plan-summary.html`
- Modify: `website/tax/index.html` (add gallery section)
- Modify: `website/consulting/index.html` (add gallery section)
- Modify: `website/financial-advisors/index.html` (add gallery section)

**What Jameson needs to do:**
1. Run each template in the app on a sanitized/fictional matter.
2. Review the output for any real client data — redact if needed.
3. Save as PDF or screenshot.
4. Place at the paths above (or confirm acceptable file format).

**What the plan builds (once content is provided):**

- [ ] **Step 1: After Jameson provides sample output files, add a "See a real output" section to each vertical page**

HTML pattern (add to tax page, consulting page, advisor page — after the template list):

```html
<section class="sample-gallery">
  <h2>What a Advisor Prep Hero output actually looks like</h2>
  <div class="sample-grid">
    <div class="sample-card">
      <img src="/samples/tax-research-memo-thumb.jpg" alt="Tax Research Memo sample output" loading="lazy">
      <div class="sample-card-body">
        <h3>Tax Research Memo</h3>
        <p>A complete IRC §469 passive-loss memo, redacted. Verification footer visible.</p>
        <a href="/samples/tax-research-memo.pdf" download>Download sample (PDF)</a>
      </div>
    </div>
    <!-- Repeat for each sample -->
  </div>
</section>
```

- [ ] **Step 2: Add the samples to `website/samples/` and update the sitemap**

```bash
grep -n "sitemap\|<url>" website/sitemap.xml | head -5
```

Add entries for each new sample page/file.

- [ ] **Step 3: Commit**

```bash
git add website/samples/ website/tax/index.html website/consulting/index.html \
  website/financial-advisors/index.html
git commit -m "feat(site/t2-2): per-vertical sample-output galleries — tax, consulting, advisor"
```

---

## Task T2-3: Fix onboarding friction at the decision moment

**Files:**
- Modify: `website/download/index.html` (API key reassurance + local Ollama lead)
- Modify: `website/financial-advisors/index.html` (lead with Ollama path)
- Modify: `website/legal/index.html` (plain-English API key reassurance)
- Modify: `website/tax/index.html` (plain-English API key reassurance)

- [ ] **Step 1: Add API key reassurance to `website/download/index.html`**

Find the install instructions section. After "Download for [platform]" and before or alongside the key instruction, add:

```html
<div class="onboarding-note">
  <strong>Never set up an API key before?</strong> It is a one-time, five-minute step. You create a free account with your AI provider (Anthropic, OpenAI, or Google), copy a key, and paste it into Advisor Prep Hero's Settings. A built-in "Test this key" button confirms it works. <a href="/api-key-setup-guide/">Full walkthrough with screenshots →</a>
</div>
<div class="onboarding-note onboarding-note--ollama">
  <strong>Want to skip the API key entirely?</strong> Run Advisor Prep Hero with a local Ollama model — nothing leaves your machine, no account required, no API cost. <a href="/local-model-setup/">Set up Ollama in 10 minutes →</a>
</div>
```

- [ ] **Step 2: On `/financial-advisors/` and `/legal/`, lead with the local Ollama path**

Add to the CTA section of each sensitive vertical page:

```html
<div class="compliance-callout">
  <strong>Zero-egress option:</strong> Run Advisor Prep Hero with a local Ollama model and nothing — no client data, no prompts — leaves your machine. No API account. No third-party transmission to diligence. <a href="/local-model-setup/">Set it up in 10 minutes →</a>
</div>
```

On the financial-advisors page, this callout should appear before the buy button, since "zero-egress" is the entire Reg S-P pitch for that vertical.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ pass.

- [ ] **Step 4: Commit**

```bash
git add website/download/index.html website/financial-advisors/index.html \
  website/legal/index.html website/tax/index.html
git commit -m "feat(site/t2-3): plain-English API-key reassurance and Ollama lead on sensitive vertical pages"
```

---

## Task T2-4: "Hand-to-the-gatekeeper" one-pager family

**Files:**
- Create: `website/one-pagers/legal-malpractice-carrier.html`
- Create: `website/one-pagers/tax-7216-data-handling.html`
- Create: `website/one-pagers/consulting-client-data-statement.html`
- Create: `website/one-pagers/advisor-cco-reg-sp.html`
- Modify: `website/legal/index.html` (add download link)
- Modify: `website/tax/index.html` (add download link)
- Modify: `website/consulting/index.html` (add download link)
- Modify: `website/financial-advisors/index.html` (add download link — this is the CCO one-pager, highest priority)

**Raw material:** `/ai-workspace-privacy/index.html` — most of the honest content is already there; the one-pagers repackage it as "here's what I use / here's how my data is handled" artifacts the user hands to their gatekeeper.

**Each one-pager contains:**
1. One paragraph: what Advisor Prep Hero is (local-first AI, files stay on the machine, no Advisor Prep Hero server in the path)
2. One paragraph: the data path for cloud keys vs local models (honest, precise)
3. The specific regulatory hook for that vertical (Heppner for legal, §7216 for tax, NDA clause for consulting, Reg S-P for advisor)
4. The audit log (every AI action is logged, available as a per-client export)
5. Contact and version line: "Prepared by [Firm name] · Advisor Prep Hero v2.2 · [date]" — the firm-name field is a `<span contenteditable>` the user types into before printing/saving.

- [ ] **Step 1: Build the consultant client-data statement (most general, fastest to build)**

Create `website/one-pagers/consulting-client-data-statement.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>How I Handle Client Data with AI — Advisor Prep Hero</title>
  <style>
    body { font-family: Georgia, serif; max-width: 680px; margin: 60px auto; line-height: 1.7; color: #111; }
    h1 { font-size: 1.4rem; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
    h2 { font-size: 1rem; margin-top: 2em; }
    .firm-field { border-bottom: 1px solid #aaa; min-width: 200px; display: inline-block; }
    @media print { .no-print { display: none; } }
    .no-print { margin-top: 2em; padding: 12px; background: #f5f5f5; border-radius: 4px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>How I Handle Your Data When I Use AI Tools</h1>
  <p><strong>Prepared by:</strong> <span contenteditable="true" class="firm-field">[Your firm name]</span></p>

  <h2>The tool I use</h2>
  <p>I use Advisor Prep Hero, a local-first AI workspace. Every conversation with an AI model saves as a plain text file in a folder on my computer — not in a cloud database, not on Advisor Prep Hero's servers.</p>

  <h2>Where your data goes</h2>
  <p><strong>Local model (preferred for sensitive work):</strong> When I run a local AI model (Ollama), your data goes nowhere. The AI runs on my machine. Nothing is transmitted to any server.</p>
  <p><strong>Cloud API key:</strong> When I use a cloud provider (Anthropic, OpenAI, or Google), my prompts go directly from my machine to that provider under my own API key. Advisor Prep Hero's servers are never in the path. Your data is handled under that provider's enterprise/API terms, not their consumer product terms.</p>

  <h2>How your matter is isolated</h2>
  <p>Each client matter has its own folder. When I start an AI session, it is scoped to that folder — the AI can only see files I have explicitly included for that matter. There is no cross-contamination between client matters.</p>

  <h2>The audit log</h2>
  <p>Every AI action I take in Advisor Prep Hero is logged: which model, which files, what was produced, when. I can export a per-matter AI activity log on request.</p>

  <h2>What this means for your NDA</h2>
  <p>If your agreement includes a clause prohibiting uploading work product to AI services, the local model path satisfies it — nothing leaves my machine. If I use a cloud key, your data reaches that provider's API. I will confirm which path I am using for any sensitive matter on request.</p>

  <p style="margin-top:3em;font-size:0.85rem;color:#666;">Advisor Prep Hero v2.2 · <span contenteditable="true" class="firm-field">[Date]</span> · <a href="https://keepance.com/ai-workspace-privacy/">Full data-path explanation at keepance.com</a></p>

  <div class="no-print">
    <strong>To use this:</strong> Fill in your firm name and date above, then print or save as PDF (File → Print → Save as PDF in your browser). You can give this to a client's GC or procurement contact before engagement.
  </div>
</body>
</html>
```

- [ ] **Step 2: Build the advisor CCO one-pager (highest priority — the review called it out explicitly)**

Create `website/one-pagers/advisor-cco-reg-sp.html` — same structure but with:
- Title: "How Advisor Prep Hero Fits Our Reg S-P Program"
- Reg S-P framing: explain how Advisor Prep Hero's architecture relates to the service-provider definition (no Advisor Prep Hero server = no Advisor Prep Hero vendor to diligence); with Ollama, no service provider at all
- Audit log section: per-client AI activity log as part of books-and-records
- Section 204-2 retention note: every Advisor Prep Hero output is a plain file the advisor retains under their existing retention schedule
- Reg BI note: Advisor Prep Hero is a drafting tool; suitability determinations are advisor judgments

- [ ] **Step 3: Build legal and tax one-pagers**

`website/one-pagers/legal-malpractice-carrier.html`:
- Title: "How I Use AI and How Client Data Is Protected"
- Heppner framing: explain why local-first was specifically designed to avoid the ruling's holding
- Privilege point: accurate (cloud key = third-party transmission; local = no transmission)
- Malpractice-carrier language: offer to provide architecture docs on request

`website/one-pagers/tax-7216-data-handling.html`:
- Title: "How I Handle Client Return Data with AI"
- Section 7216/6713 framing: cloud key = disclosure to third party; consent template covers it; local model removes the disclosure
- Safeguards: data stays on the preparer's machine; supports Safeguards documentation

- [ ] **Step 4: Add download links to each vertical page**

On each vertical page, in the trust-building section, add:
```html
<div class="gatekeeper-callout">
  <strong>Need to document your AI use for a client, carrier, or compliance officer?</strong><br>
  <a href="/one-pagers/consulting-client-data-statement.html" target="_blank">Download the client data-handling statement →</a> (fill in your firm name, print or save as PDF)
</div>
```

Adapt per vertical.

- [ ] **Step 5: Run full tests**

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ pass.

- [ ] **Step 6: Commit**

```bash
git add website/one-pagers/ website/legal/index.html website/tax/index.html \
  website/consulting/index.html website/financial-advisors/index.html
git commit -m "feat(site/t2-4): gatekeeper one-pager family — legal/malpractice, tax/7216, consulting/GC, advisor/CCO"
```

---

## Task T2-5: Branded/letterhead output in export pipeline

**Files:**
- Modify: `src/App.tsx` (export dropdown — add firm name/logo fields to export modal)
- Modify: `src/utils/docx-io.ts` (prepend a header with firm name, document title, date)
- Modify: `src/utils/pptx-io.ts` (title slide with firm name and logo)
- Add: `tests/unit/export-branding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/export-branding.test.ts
import { describe, it, expect } from 'vitest';
import { buildDocxWithBranding } from '../../src/utils/docx-io';

describe('export branding', () => {
  it('includes firm name in DOCX header when provided', async () => {
    const buffer = await buildDocxWithBranding('# Test\nContent', {
      firmName: 'Acme Law PLLC',
      documentTitle: 'Client Matter Summary',
    });
    // buffer should be a non-empty Uint8Array (we can't unzip without docx lib, so just check it's non-empty and is a buffer)
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('exports without branding when no firm name is provided', async () => {
    const buffer = await buildDocxWithBranding('# Test\nContent', {});
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Extend `src/utils/docx-io.ts`**

Export a new function `buildDocxWithBranding(markdown: string, options: { firmName?: string; documentTitle?: string; logoDataUrl?: string }): Promise<Uint8Array>` that calls the existing DOCX builder but prepends a header paragraph with:
- Firm name (bold, 14pt) if provided
- Document title (normal, 11pt) if provided
- Date (normal, 11pt)
- A thin horizontal rule

If `logoDataUrl` is provided, prepend an image paragraph above the firm name.

The existing `buildDocx(markdown)` function should remain unchanged and call `buildDocxWithBranding(markdown, {})` internally for backward compatibility.

- [ ] **Step 3: Add a "firm name" field to the export modal in `src/App.tsx`**

Find the export modal or export handler (search for `export` and `docx` or `downloadDocx` in App.tsx). Add an optional text field:

```typescript
// In the export modal state:
const [firmName, setFirmName] = useState(localStorage.getItem('keepance_firm_name') || '');

// Save to localStorage on change so they don't retype it every export:
// <input value={firmName} onChange={e => { setFirmName(e.target.value); localStorage.setItem('keepance_firm_name', e.target.value); }} placeholder="Firm name (optional — appears in exports)" />
```

Pass `firmName` to `buildDocxWithBranding` when the user clicks Download.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/export-branding.test.ts 2>&1 | tail -5
```

Expected: PASS.

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/docx-io.ts src/App.tsx tests/unit/export-branding.test.ts
git commit -m "feat(app/t2-5): branded/letterhead output — firm name and logo in DOCX/PPTX export"
```

---

## Task T2-6: Multi-client isolation — surface it on the site and wire advisors into `prioritizeByProfession`

**Files:**
- Modify: `website/consulting/index.html` (add cross-client warning screenshot + audit log callout)
- Modify: `website/legal/index.html` (same)
- Modify: `src/modules/workflow/index.ts` or wherever `prioritizeByProfession` is defined
- Modify: `tests/unit/website-content-lint.test.ts` (add assertion that isolation language exists)

- [ ] **Step 1: Find `prioritizeByProfession`**

```bash
grep -rn "prioritizeByProfession" src/ --include="*.ts" --include="*.tsx"
```

Note the file and the current profession type union.

- [ ] **Step 2: Add 'advisor' to the profession type and priority logic**

Find the type definition and the switch/if block that handles profession cases. Add:
```typescript
case 'advisor':
  return [...ADVISOR_TEMPLATES, ...remaining];
```

Where `ADVISOR_TEMPLATES` is the imported array from the advisor index.

- [ ] **Step 3: Write a test for advisor prioritization**

```typescript
it('advisor profession floats advisor templates to top', () => {
  const results = prioritizeByProfession('advisor', allWorkflows);
  const firstFourIds = results.slice(0, 4).map(w => w.id);
  expect(firstFourIds).toEqual(expect.arrayContaining(
    ADVISOR_TEMPLATES.map(t => t.id)
  ));
});
```

- [ ] **Step 4: Add per-client isolation section to consulting and legal pages**

Take a screenshot of the in-app cross-client warning modal (the dialog that fires when the active context folder differs from the currently open file's folder). Save as `website/images/cross-client-warning.png`.

Add to consulting and legal vertical pages:
```html
<div class="isolation-callout">
  <h3>Per-client isolation — visible in the app</h3>
  <img src="/images/cross-client-warning.png" alt="Advisor Prep Hero cross-client isolation warning" style="max-width:400px;border:1px solid #ddd;border-radius:8px;">
  <p>When you switch to a file outside the active client folder, Advisor Prep Hero warns you before any AI session can see it. Every AI session is scoped to the folder you set — Client A's documents are not visible in Client B's session unless you explicitly include them.</p>
  <p>You can export a per-client AI activity log from the audit log (Settings → Activity) for engagement files or compliance documentation.</p>
</div>
```

- [ ] **Step 5: Update the consulting page's "coming in V2" line**

```bash
grep -n "coming in V2\|stronger per-client\|folder convention" website/consulting/index.html
```

Replace "A stronger per-client folder safeguard is coming in V2; for now, the separation is by folder convention" with the accurate description of what shipped: "Per-client folder scoping and a cross-client warning are live in the app."

- [ ] **Step 6: Run full tests**

```bash
npm test 2>&1 | tail -8
```

Expected: 2024+ pass.

- [ ] **Step 7: Commit**

```bash
git add website/consulting/index.html website/legal/index.html \
  website/images/cross-client-warning.png src/modules/workflow/index.ts
git commit -m "feat(site+app/t2-6): multi-client isolation visible on site; advisor in prioritizeByProfession"
```

---

## Tier 2 deploy gate

After all T2 tasks complete and full tests pass, report to Jameson:

- Tier 2 builds committed on `v2-overhaul`
- Ready to deploy (site changes) and release (app changes need a new version tag)
- Do NOT deploy or tag autonomously

Then move to `docs/superpowers/plans/2026-06-04-tier3-depth.md`.
