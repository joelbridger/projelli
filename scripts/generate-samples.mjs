/**
 * Generates real sample outputs from 3 templates using Anthropic API.
 * Outputs saved to website/samples/ as markdown + HTML.
 * Run: node scripts/generate-samples.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'website', 'samples');

const client = new Anthropic();

// Fictional but realistic inputs per template
const SAMPLES = [
  {
    id: 'tax-research-memo',
    title: 'Tax Research Memo',
    pack: 'Tax Practice Pack',
    vertical: 'tax',
    systemPrompt: `You are assisting a licensed tax professional in drafting a research memo documenting a tax position for the client file. This is a practitioner work-product document. You are organizing the analysis, not providing independent tax advice.`,
    prompt: `Client name: Meridian Consulting Group LLC
Tax issue: Whether amounts received by a cash-basis LLC for a non-compete covenant in connection with the sale of a client list are ordinary income or capital gain under IRC §1235 and related authorities.
Relevant facts: Meridian Consulting Group LLC (cash-basis, fiscal year ending December 31) sold its management consulting client list to Apex Strategy Partners for $480,000. The purchase agreement allocates $320,000 to the client list (IRC §197 intangible) and $160,000 to a five-year non-compete covenant. The LLC's two members are both active participants in the business. No §338 election was made. Closing occurred October 15, 2025.
IRC sections at issue: IRC §197, IRC §1235, IRC §1221, IRC §1245, Reg. §1.197-2
Applicable cases or rulings: Revenue Ruling 2004-51; Baker v. Commissioner, T.C. Memo 1988-398
Proposed treatment: The $160,000 non-compete payment is ordinary income under IRC §1245 because the covenant relates to the disposition of §197 intangibles; the $320,000 client list payment is IRC §197 amortizable by the buyer and capital gain to the seller.

Produce a complete tax research memo in Markdown. Include the VERIFICATION section at the end with the citation quarantine table. Mark every case and ruling as ⬜ UNVERIFIED.`,
  },
  {
    id: 'consulting-discovery-synthesis',
    title: 'Client Discovery Synthesis',
    pack: 'Consulting Practice Pack',
    vertical: 'consulting',
    systemPrompt: `You are assisting an independent strategy consultant in synthesizing qualitative interview notes into a structured discovery document. You organize and surface patterns; the consultant reviews and decides what recommendations to make.`,
    prompt: `Client: Halvorsen Industrial (mid-market manufacturer, $85M revenue, 220 employees)
Engagement: Pre-strategy diagnostic — understanding operational and leadership blockers before a 2-year growth plan
Interview subjects: CEO (Marcus Halvorsen), CFO (Diana Chen), VP Operations (Todd Reyes), VP Sales (Priya Kapoor), Plant Manager (Jim Schultz)
Key themes from notes:
- CEO wants to expand into aerospace components but has no aerospace sales capability; sales team has no technical selling experience
- CFO concerned about working capital — DSO is 67 days against an industry norm of 42; sees this as the key constraint on growth financing
- VP Ops reports quality reject rate of 3.8% on precision parts, estimates it costs $1.2M/year; believes root cause is an outdated CNC calibration protocol from 2018
- VP Sales says pipeline is healthy but "we lose deals in the technical spec phase" — no pre-sales engineer on staff
- Plant Manager notes two key machinists are within 3 years of retirement with no apprenticeship program in place
- CEO and VP Sales conflict: CEO thinks sales is the bottleneck; VP Sales thinks ops quality is the bottleneck; CFO thinks neither can be fixed without solving the DSO problem first
- No mention of ERP upgrade despite being on a 2015 system
Context: 3-day on-site diagnostic, aiming to produce a 10-page findings deck and recommendation letter

Produce a complete client discovery synthesis in Markdown format. Include: executive summary, theme analysis, divergence log (where interviewees disagreed), open questions, and a recommended focus sequence. Flag any claims that need additional data validation.`,
  },
  {
    id: 'advisor-financial-plan-summary',
    title: 'Client Financial Plan Summary',
    pack: 'Advisor Practice Pack',
    vertical: 'advisor',
    systemPrompt: `You are assisting a registered investment advisor in drafting a client financial plan summary. This document is a planning framework — the advisor reviews and refines all recommendations before presenting to the client. This is not investment advice and does not constitute a financial plan. All figures are illustrative based on the inputs provided.`,
    prompt: `Client profile: David and Rachel Thornton (anonymized — use "Client" throughout, do not include any account numbers or SSNs)
Ages: 54 (David) and 51 (Rachel)
Retirement target: Both retire at 62 (8 years)
Current investable assets: ~$1.4M (60% equities, 30% fixed income, 10% cash)
Annual savings rate: $48,000/year combined (maxing 401k + IRA contributions)
Current income: $310,000 household gross
Estimated retirement spending target: $120,000/year (today's dollars)
Social Security: Estimated $42,000/year combined at age 67 (not at 62)
Other assets: Primary residence (owned outright, ~$640,000 estimated value), no rental properties
Debt: None
Key concerns expressed by client: (1) Whether they can retire at 62 given SS gap years, (2) healthcare coverage from 62-65 before Medicare, (3) whether current equity allocation is appropriate given 8-year horizon, (4) long-term care planning
Risk tolerance: Moderate (stated); consistent with current allocation

Produce a client financial plan summary in Markdown format. Include: plan overview, retirement readiness analysis, key gaps and risks, recommended discussion topics for next meeting, and a suitability notes section. Include a DRAFT / ADVISOR REVIEW REQUIRED banner. Do not make specific investment recommendations — frame as discussion items. Strip all identifying information.`,
  },
];

function fillPromptTemplate(template, vars) {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`{{${k}}}`, 'g'), v),
    template
  );
}

function markdownToHtml(md, title, pack, vertical) {
  // Very basic MD to HTML — just enough for a readable sample page
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  const verticalColor = {
    tax: '#3B82F6',
    consulting: '#8B5CF6',
    advisor: '#10B981',
  }[vertical] || '#3B82F6';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Sample Output — Keepance</title>
  <meta name="robots" content="noindex">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; background: #f8fafc; color: #1a1a1a; line-height: 1.75; }
    .header { background: #0A2540; color: white; padding: 16px 32px; display: flex; align-items: center; gap: 16px; }
    .header-badge { background: ${verticalColor}; color: white; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 4px; font-family: Arial, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }
    .header-title { font-family: Arial, sans-serif; font-size: 0.95rem; color: rgba(255,255,255,0.7); }
    .meta-bar { background: #FEF3C7; border-bottom: 1px solid #F59E0B; padding: 12px 32px; font-family: Arial, sans-serif; font-size: 0.85rem; color: #92400E; display: flex; align-items: center; gap: 8px; }
    .meta-bar strong { color: #78350F; }
    .document { max-width: 800px; margin: 40px auto; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 48px 56px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
    h1 { font-size: 1.5rem; color: #0A2540; margin-bottom: 8px; line-height: 1.3; }
    h2 { font-size: 1.15rem; color: #0A2540; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; font-family: Arial, sans-serif; }
    h3 { font-size: 1rem; color: #334155; margin: 20px 0 8px; font-family: Arial, sans-serif; }
    p { margin-bottom: 14px; font-size: 0.95rem; }
    blockquote { border-left: 4px solid ${verticalColor}; padding: 12px 18px; background: #f8fafc; margin: 20px 0; font-size: 0.9rem; color: #475569; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
    strong { color: #0A2540; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.875rem; }
    th { background: #0A2540; color: white; padding: 10px 14px; text-align: left; font-family: Arial, sans-serif; }
    td { padding: 9px 14px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { max-width: 800px; margin: 0 auto 60px; padding: 20px 56px; font-family: Arial, sans-serif; font-size: 0.8rem; color: #94a3b8; display: flex; justify-content: space-between; }
    .footer a { color: #3B82F6; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-badge">${pack}</span>
    <span class="header-title">Sample output · Generated with Keepance v2.4 · Fictional matter — no real client data</span>
  </div>
  <div class="meta-bar">
    <strong>Sample only.</strong> This document was generated using fictional inputs to demonstrate what Keepance produces. Every figure, name, and fact is invented. Verify all outputs against primary sources before professional use.
  </div>
  <div class="document">
    <p>${html}</p>
  </div>
  <div class="footer">
    <span>Generated by Keepance — <a href="https://keepance.com">keepance.com</a></span>
    <span>30-day free trial, no card required</span>
  </div>
</body>
</html>`;
}

async function generateSample(sample) {
  console.log(`\nGenerating: ${sample.title}...`);

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system: sample.systemPrompt,
    messages: [{ role: 'user', content: sample.prompt }],
  });

  const markdown = response.content[0].type === 'text' ? response.content[0].text : '';
  const html = markdownToHtml(markdown, sample.title, sample.pack, sample.vertical);

  await fs.mkdir(SAMPLES_DIR, { recursive: true });

  const mdPath = path.join(SAMPLES_DIR, `${sample.id}.md`);
  const htmlPath = path.join(SAMPLES_DIR, `${sample.id}.html`);

  await fs.writeFile(mdPath, markdown, 'utf-8');
  await fs.writeFile(htmlPath, html, 'utf-8');

  console.log(`  ✓ Saved ${sample.id}.md (${markdown.length} chars)`);
  console.log(`  ✓ Saved ${sample.id}.html`);

  return { id: sample.id, mdPath, htmlPath, charCount: markdown.length };
}

async function main() {
  console.log('Keepance sample generator — using claude-opus-4-8');
  console.log(`Saving to: ${SAMPLES_DIR}\n`);

  const results = [];
  for (const sample of SAMPLES) {
    try {
      const result = await generateSample(sample);
      results.push({ ...result, status: 'ok' });
    } catch (err) {
      console.error(`  ✗ Failed ${sample.id}: ${err.message}`);
      results.push({ id: sample.id, status: 'error', error: err.message });
    }
  }

  console.log('\n--- Summary ---');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : '✗';
    console.log(`${icon} ${r.id}${r.status === 'ok' ? ` (${r.charCount} chars)` : `: ${r.error}`}`);
  }

  const ok = results.filter(r => r.status === 'ok');
  console.log(`\n${ok.length}/${results.length} samples generated.`);
  if (ok.length > 0) {
    console.log(`\nNext step: add gallery sections to vertical pages,`);
    console.log(`then deploy with: bash infra/deploy.sh`);
  }
}

main().catch(console.error);
