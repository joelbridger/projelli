#!/usr/bin/env -S npx tsx
/**
 * export-advisor-packet.ts
 *
 * Generates clean, self-contained HTML "advisor packets" for Keepance's
 * Legal and Tax workflow-template packs. The goal: let a recruited attorney
 * or CPA review the templates in any browser WITHOUT installing the desktop
 * app. This unblocks advisor recruitment (the #1 launch blocker).
 *
 * It IMPORTS the real template modules (LEGAL_TEMPLATES, TAX_TEMPLATES) and
 * renders the structured data — it does NOT regex-parse source. That means
 * what the reviewer sees is exactly what the app ships.
 *
 * For each template the packet renders:
 *   - Name + one-line description
 *   - "What it produces" (derived from description / output prompt)
 *   - "Interview questions" — numbered, with helper text, input type, options
 *   - "Output prompt (verbatim)" — the full promptTemplate + systemPrompt in a
 *     monospace, scrollable block; {{placeholders}} shown as-is
 *   - A "Please verify" claim-risk note specific to that template
 *   - A "REVIEWER SIGN-OFF" box (three checkboxes, notes area, name/bar/date)
 *
 * Output:
 *   advisor-packet/legal-pack-review.html
 *   advisor-packet/tax-pack-review.html
 *
 * Usage:
 *   npx tsx scripts/export-advisor-packet.ts
 *
 * Notes:
 *   - tsx honors the tsconfig `@/` path alias, so the `@/types/workflow`
 *     imports inside the template modules resolve. If a future tsx version
 *     drops alias support, switch the two imports below to the relative form
 *     shown in the commented fallback.
 *   - This script READS template modules only. It never modifies them.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Primary import via the `@/` path alias (tsx reads tsconfig paths).
// Fallback (if the alias ever fails to resolve):
//   import { LEGAL_TEMPLATES } from '../src/modules/workflow/templates/legal/index';
//   import { TAX_TEMPLATES } from '../src/modules/workflow/templates/tax/index';
import { LEGAL_TEMPLATES } from '@/modules/workflow/templates/legal/index';
import { TAX_TEMPLATES } from '@/modules/workflow/templates/tax/index';
import type {
  WorkflowTemplate,
  WorkflowStep,
  InterviewQuestion,
  InterviewStepConfig,
  GenerateStepConfig,
} from '@/types/workflow';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO_ROOT, 'advisor-packet');

// ---------------------------------------------------------------------------
// Claim-risk "Please verify" notes. Keyed by a normalized template name so a
// rename like "Section 7216 Consent Form" still matches the spec's
// "§7216 Consent Template". Each note tells the reviewer exactly which
// statutory/professional claims to check.
// ---------------------------------------------------------------------------

interface VerifyNote {
  /** Substrings (lowercased) any of which must appear in the template name. */
  match: string[];
  /** Short risk banner, e.g. "HIGHEST RISK". Empty string = no banner. */
  flag: string;
  /** Bullet points the reviewer should confirm. */
  points: string[];
}

const LEGAL_VERIFY_NOTES: VerifyNote[] = [
  {
    match: ['deposition contradiction'],
    flag: '',
    points: [
      'Confirm the "suggested follow-up questions" framing reads as a drafting aid, not legal-strategy advice.',
      'Confirm the no-fabrication / "do not speculate beyond the record" instruction is adequate.',
    ],
  },
  {
    match: ['evidence gap'],
    flag: '',
    points: [
      'Verify the burden-of-proof standards listed are stated correctly.',
      'Confirm that "element coverage" is framed as an inventory, not a legal-sufficiency opinion.',
    ],
  },
  {
    match: ['case timeline'],
    flag: '',
    points: [
      'Check the statute-of-limitations flagging language.',
      'Confirm the "verify against current law / scheduling order" caveats are strong enough.',
    ],
  },
  {
    match: ['privilege log'],
    flag: 'HIGHEST RISK',
    points: [
      'Confirm the non-revealing description standard is correctly stated.',
      'Confirm the attorney-client vs. work-product basis distinction is accurate.',
      'Confirm nothing in this prompt or its example descriptions could itself waive privilege.',
      'Check the column format against common local-rule requirements.',
    ],
  },
  {
    match: ['discovery document triage', 'discovery triage'],
    flag: '',
    points: [
      'Confirm the privilege-flag instructions are sufficient.',
      'Confirm the proximity-search syntax suggestions are sane.',
    ],
  },
  {
    match: ['patent disclosure'],
    flag: 'NEEDS A PATENT ATTORNEY',
    points: [
      'Confirm the best-mode disclosure requirement is stated correctly.',
      'Confirm the duty-of-candor to the USPTO is stated correctly.',
      'Confirm the inventorship framing is accurate.',
      'Confirm the statutory / on-sale bar checklist is correct.',
      'Confirm the "claims sketch is not formal claims" disclaimer is adequate.',
      'Confirm the EU / PCT absolute-novelty framing is correct.',
    ],
  },
  {
    match: ['client intake'],
    flag: '',
    points: [
      'Confirm the conflict-check guidance is adequate (it should disclaim that it does NOT perform the check).',
      'Confirm the statute-of-limitations flagging caveats are adequate.',
    ],
  },
];

const TAX_VERIFY_NOTES: VerifyNote[] = [
  {
    match: ['7216', 'section 7216', '§7216'],
    flag: 'MOST CRITICAL',
    points: [
      'Confirm Rev. Proc. 2013-14 §5.04 is cited correctly and is CURRENT.',
      'Confirm Treas. Reg. §301.7216-3 is cited correctly.',
      'Confirm the 12-point type rule is correctly stated.',
      'Confirm the separate-document and consent-before-disclosure rules are correctly stated.',
      'Confirm the mandatory consent language matches current regulatory requirements.',
    ],
  },
  {
    match: ['tax research memo', 'research memo'],
    flag: '',
    points: [
      'Confirm the penalty-standard definitions ("substantial authority," "reasonable basis," "more likely than not") are correct and correctly ordered.',
      'Confirm the "PRIVILEGED" header is appropriate given the limits of the §7525 practitioner privilege.',
    ],
  },
  {
    match: ['audit defense'],
    flag: '',
    points: [
      'Confirm the §6501 / §6502 statute-of-limitations statements are correct.',
      'Confirm the 30-day vs. 90-day (150 outside the US) Tax Court deadlines are correct.',
      'Confirm the probability thresholds are reasonable.',
      'Confirm the Kovel reference is used correctly.',
    ],
  },
  {
    match: ['quarterly estimate', 'quarterly reminder'],
    flag: 'CLIENT-FACING, DATED MATH',
    points: [
      'Confirm the safe-harbor math: 100% of prior-year (110% if prior-year AGI > $150k), 90% of current-year.',
      'Confirm the hardcoded due dates — these shift with weekends/holidays each year and may need a per-year update.',
    ],
  },
  {
    match: ['engagement letter'],
    flag: '',
    points: [
      'Confirm the liability-limitation and scope language is appropriate and not overreaching.',
    ],
  },
  {
    match: ['pre-review checklist', 'pre review checklist'],
    flag: '',
    points: [
      'Confirm the form / box references are accurate.',
      'Confirm the QBI eligibility framing is accurate.',
      'Confirm the credit phase-out references are accurate.',
    ],
  },
  {
    match: ['client document inventory', 'document inventory'],
    flag: 'LOW RISK',
    points: [
      'Confirm the document categories are complete.',
    ],
  },
];

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Find the verify note whose match list hits the template name. */
function findVerifyNote(template: WorkflowTemplate, notes: VerifyNote[]): VerifyNote | undefined {
  const haystack = `${template.name} ${template.id}`.toLowerCase();
  return notes.find((note) => note.match.some((m) => haystack.includes(m.toLowerCase())));
}

function isInterviewStep(step: WorkflowStep): step is WorkflowStep & { config: InterviewStepConfig } {
  return step.type === 'interview' && 'questions' in step.config;
}

function isGenerateStep(step: WorkflowStep): step is WorkflowStep & { config: GenerateStepConfig } {
  return step.type === 'generate' && 'promptTemplate' in step.config;
}

/** Pull all interview questions across every interview step (handles >1). */
function collectQuestions(template: WorkflowTemplate): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [];
  for (const step of template.steps) {
    if (isInterviewStep(step)) {
      questions.push(...step.config.questions);
    }
  }
  return questions;
}

/** Pull all generate steps across the template (handles >1). */
function collectGenerateSteps(template: WorkflowTemplate): GenerateStepConfig[] {
  const configs: GenerateStepConfig[] = [];
  for (const step of template.steps) {
    if (isGenerateStep(step)) {
      configs.push(step.config);
    }
  }
  return configs;
}

const INPUT_TYPE_LABEL: Record<InterviewQuestion['type'], string> = {
  text: 'Short text',
  textarea: 'Long text / paste area',
  select: 'Single choice (dropdown)',
  multiselect: 'Multiple choice (select all that apply)',
};

/** Derive a one-sentence "what it produces" line from the template. */
function deriveProduces(template: WorkflowTemplate): string {
  // The first generate step's outputFile tells us the artifact name; the
  // description tells us what it is. Combine into one plain sentence.
  const gens = collectGenerateSteps(template);
  const outputFile = gens[0]?.outputFile ?? template.outputs[0];
  // Take the first sentence of the description as the substance.
  const firstSentence = template.description.split(/(?<=\.)\s/)[0]?.trim() ?? template.description.trim();
  const artifact = outputFile ? ` It is saved as a Markdown file (<code>${escapeHtml(outputFile)}</code>) the professional then edits.` : '';
  // Lowercase the leading verb-ish word lightly only if it starts uppercase noun-phrase; keep as-is to stay faithful.
  return `A first-draft document: ${escapeHtml(firstSentence)}${firstSentence.endsWith('.') ? '' : '.'}${artifact}`;
}

function renderQuestion(q: InterviewQuestion, index: number): string {
  const typeLabel = INPUT_TYPE_LABEL[q.type] ?? escapeHtml(q.type);
  const required = q.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>';
  const desc = q.description
    ? `<div class="q-desc">${escapeHtml(q.description)}</div>`
    : '';
  const placeholder = q.placeholder
    ? `<div class="q-meta"><span class="q-meta-label">Example answer:</span> <span class="q-example">${escapeHtml(q.placeholder)}</span></div>`
    : '';
  const defaultVal = q.defaultValue
    ? `<div class="q-meta"><span class="q-meta-label">Default:</span> ${escapeHtml(q.defaultValue)}</div>`
    : '';
  const options =
    q.options && q.options.length > 0
      ? `<div class="q-meta"><span class="q-meta-label">Options:</span><ul class="q-options">${q.options
          .map((o) => `<li>${escapeHtml(o)}</li>`)
          .join('')}</ul></div>`
      : '';
  return `
        <li class="question">
          <div class="q-head">
            <span class="q-text">${escapeHtml(q.question)}</span>
            ${required}
          </div>
          <div class="q-type"><span class="q-meta-label">Input type:</span> ${typeLabel}</div>
          ${desc}
          ${options}
          ${placeholder}
          ${defaultVal}
        </li>`;
}

function renderPromptBlock(gen: GenerateStepConfig, multi: boolean, idx: number): string {
  const heading = multi ? `Output prompt ${idx + 1} (verbatim)` : 'Output prompt (verbatim)';
  const outputFile = gen.outputFile
    ? `<div class="prompt-file">Generates: <code>${escapeHtml(gen.outputFile)}</code></div>`
    : '';
  const systemBlock = gen.systemPrompt
    ? `
          <div class="prompt-subhead">System prompt (sets the assistant's role and guardrails)</div>
          <pre class="prompt-pre">${escapeHtml(gen.systemPrompt)}</pre>`
    : '';
  return `
        <div class="prompt-section">
          <h4 class="prompt-heading">${escapeHtml(heading)}</h4>
          ${outputFile}
          <p class="prompt-note">This is the exact instruction sent to the AI. Text in <code>{{double braces}}</code> is replaced with the professional's answers at run time. Read it as the recipe that produces the draft.</p>
          ${systemBlock}
          <div class="prompt-subhead">Prompt template</div>
          <pre class="prompt-pre">${escapeHtml(gen.promptTemplate)}</pre>
        </div>`;
}

function renderVerifyBox(note: VerifyNote | undefined, packKind: 'legal' | 'tax'): string {
  if (!note) {
    return `
        <div class="verify">
          <div class="verify-head">Please verify</div>
          <p class="verify-generic">Confirm that every ${
            packKind === 'legal' ? 'statutory citation, procedural standard,' : 'statutory citation, regulatory standard,'
          } and professional claim embedded in the prompt above is accurate and current, and that nothing would mislead a practitioner.</p>
        </div>`;
  }
  const flag = note.flag
    ? `<span class="verify-flag verify-flag-${note.flag.toLowerCase().replace(/[^a-z]+/g, '-')}">${escapeHtml(note.flag)}</span>`
    : '';
  return `
        <div class="verify">
          <div class="verify-head">Please verify ${flag}</div>
          <ul class="verify-list">
            ${note.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('\n            ')}
          </ul>
        </div>`;
}

function renderSignoff(template: WorkflowTemplate): string {
  const safeId = escapeHtml(template.id);
  return `
        <div class="signoff" role="group" aria-label="Reviewer sign-off for ${escapeHtml(template.name)}">
          <div class="signoff-head">Reviewer sign-off</div>
          <div class="signoff-options">
            <label class="signoff-check"><input type="checkbox" name="${safeId}-accurate"> Accurate as written</label>
            <label class="signoff-check"><input type="checkbox" name="${safeId}-accurate-changes"> Accurate with the changes I noted</label>
            <label class="signoff-check"><input type="checkbox" name="${safeId}-not-accurate"> Not accurate / do not ship</label>
          </div>
          <div class="signoff-notes-label">Notes / corrections</div>
          <div class="signoff-notes" contenteditable="true" spellcheck="true"></div>
          <div class="signoff-fields">
            <div class="signoff-field"><span class="signoff-field-label">Reviewer name</span><span class="signoff-line"></span></div>
            <div class="signoff-field"><span class="signoff-field-label">License / Bar #</span><span class="signoff-line"></span></div>
            <div class="signoff-field"><span class="signoff-field-label">Date</span><span class="signoff-line signoff-line-short"></span></div>
          </div>
        </div>`;
}

function renderTemplate(
  template: WorkflowTemplate,
  index: number,
  notes: VerifyNote[],
  packKind: 'legal' | 'tax',
): string {
  const questions = collectQuestions(template);
  const gens = collectGenerateSteps(template);
  const note = findVerifyNote(template, notes);

  const questionsHtml =
    questions.length > 0
      ? `<ol class="questions">${questions.map((q, i) => renderQuestion(q, i)).join('')}\n        </ol>`
      : `<p class="empty">No interview questions defined for this template.</p>`;

  const promptsHtml =
    gens.length > 0
      ? gens.map((g, i) => renderPromptBlock(g, gens.length > 1, i)).join('\n')
      : `<p class="empty">No generation prompt defined for this template.</p>`;

  return `
      <section class="template" id="${escapeHtml(template.id)}">
        <div class="template-num">Template ${index + 1}</div>
        <h2 class="template-name">${escapeHtml(template.name)}</h2>
        <p class="template-desc">${escapeHtml(template.description)}</p>

        <h3 class="subhead">What it produces</h3>
        <p class="produces">${deriveProduces(template)}</p>

        <h3 class="subhead">Interview questions</h3>
        <p class="subhead-note">These are the questions the professional answers before the draft is generated. Each answer fills a <code>{{placeholder}}</code> in the prompt below.</p>
        ${questionsHtml}

        <h3 class="subhead">Output prompt (verbatim)</h3>
        ${promptsHtml}

        ${renderVerifyBox(note, packKind)}

        ${renderSignoff(template)}
      </section>`;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

const STYLE = `
    :root {
      --ink: #1a1d21;
      --muted: #5b6470;
      --line: #e2e5ea;
      --bg: #ffffff;
      --soft: #f6f7f9;
      --code-bg: #f4f5f7;
      --accent: #2f3b4c;
      --warn-bg: #fff8e6;
      --warn-line: #f0d68a;
      --warn-ink: #7a5a00;
      --crit-bg: #fdeceb;
      --crit-line: #e6a39d;
      --crit-ink: #8a2820;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      background: var(--soft);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans", sans-serif;
      font-size: 16px;
      line-height: 1.6;
    }
    .wrap {
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 28px 96px;
    }
    header.masthead {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 32px 32px 28px;
      margin-bottom: 28px;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      margin: 0 0 8px;
    }
    h1 {
      font-size: 28px;
      line-height: 1.25;
      margin: 0 0 16px;
      letter-spacing: -0.01em;
    }
    .masthead p { margin: 0 0 14px; color: #353b43; }
    .masthead p:last-child { margin-bottom: 0; }
    .count-pill {
      display: inline-block;
      background: var(--soft);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      margin-top: 8px;
    }
    .toc {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 28px;
    }
    .toc h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 12px; }
    .toc ol { margin: 0; padding-left: 20px; }
    .toc li { margin: 4px 0; }
    .toc a { color: var(--accent); text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
    .toc .toc-flag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--crit-ink); margin-left: 6px; }

    .template {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 32px 32px 28px;
      margin-bottom: 24px;
    }
    .template-num {
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .template-name {
      font-size: 23px;
      margin: 0 0 8px;
      letter-spacing: -0.01em;
    }
    .template-desc { margin: 0 0 8px; color: #353b43; }

    .subhead {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin: 26px 0 6px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }
    .subhead-note { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
    .produces { margin: 0; }
    .empty { color: var(--muted); font-style: italic; }

    ol.questions { margin: 0; padding-left: 0; list-style: none; counter-reset: q; }
    li.question {
      counter-increment: q;
      position: relative;
      padding: 14px 0 14px 40px;
      border-bottom: 1px solid var(--line);
    }
    li.question:last-child { border-bottom: none; }
    li.question::before {
      content: counter(q);
      position: absolute;
      left: 0;
      top: 14px;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--soft);
      border: 1px solid var(--line);
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .q-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .q-text { font-weight: 600; font-size: 16px; }
    .req, .opt {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
    }
    .req { background: #eef3ff; color: #2b4a8b; }
    .opt { background: var(--soft); color: var(--muted); }
    .q-type { font-size: 14px; color: var(--muted); margin-top: 2px; }
    .q-desc { margin-top: 6px; color: #353b43; font-size: 15px; }
    .q-meta { margin-top: 6px; font-size: 14px; color: #353b43; }
    .q-meta-label { font-weight: 600; color: var(--muted); }
    .q-example { color: #4a5159; }
    ul.q-options { margin: 4px 0 0; padding-left: 20px; }
    ul.q-options li { margin: 1px 0; }

    .prompt-section { margin-top: 8px; }
    .prompt-section + .prompt-section { margin-top: 22px; padding-top: 18px; border-top: 1px dashed var(--line); }
    .prompt-heading { font-size: 16px; margin: 0 0 6px; }
    .prompt-file { font-size: 14px; color: var(--muted); margin-bottom: 8px; }
    .prompt-note { font-size: 14px; color: var(--muted); margin: 0 0 12px; }
    .prompt-subhead {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      font-weight: 700;
      margin: 14px 0 6px;
    }
    pre.prompt-pre {
      background: var(--code-bg);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px 18px;
      margin: 0;
      max-height: 460px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.55;
      color: #2a2f36;
      white-space: pre-wrap;
      word-wrap: break-word;
      tab-size: 2;
    }
    code {
      background: var(--code-bg);
      border-radius: 4px;
      padding: 1px 5px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.88em;
    }

    .verify {
      margin-top: 22px;
      background: var(--warn-bg);
      border: 1px solid var(--warn-line);
      border-radius: 8px;
      padding: 16px 18px;
    }
    .verify-head {
      font-weight: 700;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--warn-ink);
      margin-bottom: 8px;
    }
    .verify-flag {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 999px;
      margin-left: 8px;
      vertical-align: middle;
      background: var(--crit-bg);
      border: 1px solid var(--crit-line);
      color: var(--crit-ink);
    }
    .verify-flag-low-risk { background: #eaf6ee; border-color: #a8d8ba; color: #1f6b3a; }
    .verify-list { margin: 0; padding-left: 20px; color: #5c4a14; }
    .verify-list li { margin: 3px 0; }
    .verify-generic { margin: 0; color: #5c4a14; }

    .signoff {
      margin-top: 22px;
      background: var(--soft);
      border: 2px solid var(--accent);
      border-radius: 10px;
      padding: 18px 20px;
    }
    .signoff-head {
      font-weight: 800;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin-bottom: 12px;
    }
    .signoff-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .signoff-check { font-size: 15px; display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .signoff-check input { width: 18px; height: 18px; }
    .signoff-notes-label { font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    .signoff-notes {
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 6px;
      min-height: 96px;
      padding: 10px 12px;
      font-size: 15px;
      background-image: repeating-linear-gradient(
        transparent,
        transparent 27px,
        var(--line) 27px,
        var(--line) 28px
      );
      line-height: 28px;
    }
    .signoff-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      margin-top: 16px;
    }
    .signoff-field { display: flex; align-items: baseline; gap: 8px; flex: 1 1 auto; min-width: 180px; }
    .signoff-field-label { font-size: 13px; font-weight: 600; color: var(--muted); white-space: nowrap; }
    .signoff-line { flex: 1 1 auto; border-bottom: 1px solid #99a2ad; min-width: 80px; height: 20px; }
    .signoff-line-short { max-width: 130px; }

    footer.foot {
      margin-top: 32px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }

    @media print {
      body { background: #fff; font-size: 12px; }
      .wrap { max-width: none; padding: 0; }
      header.masthead, .toc, .template { border: 1px solid #ccc; border-radius: 0; box-shadow: none; break-inside: avoid; }
      .template { page-break-inside: avoid; }
      pre.prompt-pre { max-height: none; overflow: visible; }
      .signoff { break-inside: avoid; }
    }
    @media (max-width: 600px) {
      .wrap { padding: 24px 14px 64px; }
      header.masthead, .template { padding: 22px 18px; }
      h1 { font-size: 23px; }
    }`;

interface PackMeta {
  kind: 'legal' | 'tax';
  packTitle: string;
  packVersion: string;
  profession: string;
  credential: string;
}

function renderIntro(meta: PackMeta, count: number): string {
  return `
      <header class="masthead">
        <p class="eyebrow">Keepance · Advisor review packet</p>
        <h1>${escapeHtml(meta.packTitle)} — template review for a licensed ${escapeHtml(meta.profession)}</h1>
        <p><strong>Keepance is a local-first, bring-your-own-API-key desktop AI workspace.</strong> It runs on the professional's own computer; client data and API keys stay on that machine and AI requests go directly to the model provider, never through Keepance's servers. The templates in this packet generate <strong>first drafts</strong> — a privilege log, a consent form, a research memo, and so on — that the licensed professional then reads, edits, and is fully responsible for. The AI does not give legal or tax advice and does not file, certify, or send anything. It assembles a starting document from the answers the professional types in.</p>
        <p>What I am asking you to confirm: that the statutory, regulatory, and professional claims embedded in these prompts are <strong>accurate and current</strong>, and that nothing in them would mislead a competent practitioner who relied on the generated draft. You do not need to install anything — everything the app would send to the AI is reproduced verbatim below. Below each template there is a sign-off box for your verdict and any corrections. <strong>Approving a pack optionally grants permission to credit you (by name and credential) inside the app as a reviewing professional</strong> — this is optional and you can decline credit while still approving.</p>
        <span class="count-pill">${count} template${count === 1 ? '' : 's'} in this pack · ${escapeHtml(meta.packVersion)}</span>
      </header>`;
}

function renderToc(templates: WorkflowTemplate[], notes: VerifyNote[]): string {
  const items = templates
    .map((t) => {
      const note = findVerifyNote(t, notes);
      const flag = note?.flag ? ` <span class="toc-flag">${escapeHtml(note.flag)}</span>` : '';
      return `        <li><a href="#${escapeHtml(t.id)}">${escapeHtml(t.name)}</a>${flag}</li>`;
    })
    .join('\n');
  return `
      <nav class="toc" aria-label="Templates in this pack">
        <h2>Templates in this pack</h2>
        <ol>
${items}
        </ol>
      </nav>`;
}

function renderPacket(meta: PackMeta, templates: WorkflowTemplate[], notes: VerifyNote[]): string {
  const body = templates.map((t, i) => renderTemplate(t, i, notes, meta.kind)).join('\n');
  const generatedAt = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(meta.packTitle)} — Keepance advisor review</title>
  <style>${STYLE}
  </style>
</head>
<body>
  <main class="wrap">
${renderIntro(meta, templates.length)}
${renderToc(templates, notes)}
${body}
    <footer class="foot">
      Generated ${generatedAt} from the live Keepance template source · ${escapeHtml(meta.packVersion)} · self-contained, no external assets · for advisor review only
    </footer>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const legalMeta: PackMeta = {
    kind: 'legal',
    packTitle: 'Legal Practice Pack',
    packVersion: 'Legal Practice Pack v2.1 (draft)',
    profession: 'attorney',
    credential: 'Bar #',
  };
  const taxMeta: PackMeta = {
    kind: 'tax',
    packTitle: 'Tax Practice Pack',
    packVersion: 'Tax Practice Pack v2.2 (draft)',
    profession: 'CPA or enrolled agent',
    credential: 'License #',
  };

  const legalHtml = renderPacket(legalMeta, LEGAL_TEMPLATES, LEGAL_VERIFY_NOTES);
  const taxHtml = renderPacket(taxMeta, TAX_TEMPLATES, TAX_VERIFY_NOTES);

  const legalPath = resolve(OUT_DIR, 'legal-pack-review.html');
  const taxPath = resolve(OUT_DIR, 'tax-pack-review.html');

  await writeFile(legalPath, legalHtml, 'utf8');
  await writeFile(taxPath, taxHtml, 'utf8');

  const legalStat = await stat(legalPath);
  const taxStat = await stat(taxPath);

  // Warn if any template lacks a matched verify note (helps catch renames).
  const unmatched: string[] = [];
  for (const t of LEGAL_TEMPLATES) {
    if (!findVerifyNote(t, LEGAL_VERIFY_NOTES)) unmatched.push(`legal/${t.name}`);
  }
  for (const t of TAX_TEMPLATES) {
    if (!findVerifyNote(t, TAX_VERIFY_NOTES)) unmatched.push(`tax/${t.name}`);
  }

  console.log('Advisor packets generated:');
  console.log(`  ${legalPath}`);
  console.log(`    ${LEGAL_TEMPLATES.length} templates · ${legalStat.size.toLocaleString()} bytes`);
  console.log(`  ${taxPath}`);
  console.log(`    ${TAX_TEMPLATES.length} templates · ${taxStat.size.toLocaleString()} bytes`);
  if (unmatched.length > 0) {
    console.warn('\n[warn] No "Please verify" note matched these templates (check for a rename):');
    for (const u of unmatched) console.warn(`  - ${u}`);
  } else {
    console.log('\nAll templates matched a "Please verify" claim-risk note.');
  }
}

main().catch((err: unknown) => {
  console.error('Failed to generate advisor packets:', err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
