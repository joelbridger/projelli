/**
 * Ask answer-quality eval cases.
 *
 * Each case is a fixed question over a fixed slice of the eval corpus, with an
 * explicit, gradeable expectation:
 *   - `expect: 'answer'` — the model must answer AND ground it with the required
 *     citation(s) (`mustCite`), include the right facts (`mustInclude`), and not
 *     fabricate (`mustNotInclude`).
 *   - `expect: 'decline'` — the answer is NOT in the retrieved context, so the
 *     model must decline (say it can't find it) instead of guessing.
 *
 * `gold` is a hand-written answer that SHOULD pass — the deterministic gate runs
 * it through the grader and asserts it passes, which locks the rubric to a real
 * exemplar. `traps` are deliberately-wrong answers that SHOULD fail; the gate
 * asserts they fail, which proves the grader actually discriminates (a grader
 * that passes everything is worthless). `rubric` drives the nightly LLM-judge.
 *
 * Categories covered: single-fact grounding, multi-fact synthesis,
 * contradiction-awareness (deposition vs. summary), must-decline (absent fact),
 * cross-matter isolation, and no-outside-knowledge.
 */

import type { CorpusDoc, HitSelection } from './corpus';

export interface CiteTarget {
  doc: CorpusDoc;
  /** 0-based paragraph index within the document. */
  para: number;
}

export interface TrapAnswer {
  /** Why this answer is wrong — shown in the gate failure message. */
  why: string;
  answer: string;
}

export interface EvalCase {
  id: string;
  question: string;
  /** Retrieved context (the "hits") this case is answered over. */
  sources: HitSelection[];
  expect: 'answer' | 'decline';
  /** Answer cases: the grounded citation(s) the answer must contain. */
  mustCite?: CiteTarget[];
  /** Strings (case-insensitive substring) or regexes the answer MUST contain. */
  mustInclude?: (string | RegExp)[];
  /** Strings/regexes the answer MUST NOT contain (fabrication / leak guards). */
  mustNotInclude?: (string | RegExp)[];
  /** Natural-language grading rubric for the nightly LLM-as-judge. */
  rubric: string;
  /** A hand-written answer that should PASS (gate asserts it does). */
  gold: string;
  /** Deliberately-wrong answers that should FAIL (gate asserts they do). */
  traps?: TrapAnswer[];
  tags?: string[];
}

const DOLLARS = /\$\s?\d/;

export const CASES: EvalCase[] = [
  /* ───────────────────────── A. Johnson — single-fact grounding ───────────── */
  {
    id: 'johnson-severance',
    question: 'How many weeks of severance did Nexus Dynamics offer Marcus Johnson?',
    sources: [{ doc: 'johnson-deposition.md', para: 4 }, { doc: 'johnson-deposition.md', para: 3 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 4 }],
    mustInclude: [/four weeks|4 weeks/i],
    mustNotInclude: [/eight weeks|8 weeks/i],
    rubric: 'Must say the severance offer was four weeks of pay and cite the deposition. Must not say eight weeks.',
    gold: 'Nexus Dynamics offered Marcus Johnson a severance package equal to four weeks of pay, which he declined [johnson-deposition.md paragraph 4].',
    traps: [
      { why: 'wrong figure (eight weeks is the summary, not the deposition)', answer: 'Nexus Dynamics offered him eight weeks of severance [johnson-deposition.md paragraph 4].' },
      { why: 'right fact but no citation', answer: 'They offered him four weeks of severance pay.' },
      { why: 'right fact, citation points at a paragraph that was not retrieved', answer: 'They offered four weeks of severance [johnson-deposition.md paragraph 1].' },
    ],
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-deadline',
    question: 'What written-response deadline did the compliance team give Marcus Johnson, according to his deposition?',
    sources: [{ doc: 'johnson-deposition.md', para: 3 }, { doc: 'johnson-deposition.md', para: 2 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 3 }],
    mustInclude: [/October 17/i],
    mustNotInclude: [/October 10/i],
    rubric: 'Must give the deadline as October 17, 2025 and cite the deposition.',
    gold: 'According to his deposition, the compliance team gave Johnson a written-response deadline of October 17, 2025 [johnson-deposition.md paragraph 3].',
    traps: [
      { why: 'used the summary date instead of the deposition date', answer: 'The deadline was October 10, 2025 [johnson-deposition.md paragraph 3].' },
    ],
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-forwarded-docs',
    question: 'Did Marcus Johnson forward any documents to his personal email, and when?',
    sources: [{ doc: 'johnson-deposition.md', para: 2 }, { doc: 'johnson-deposition.md', para: 1 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 2 }],
    mustInclude: [/personal email/i, /September 9|September 10|Sept/i],
    rubric: 'Must say Johnson forwarded internal compliance documents to his personal email on September 9-10, 2025, and cite the deposition.',
    gold: 'Yes. Johnson testified that on September 9 and 10, 2025 he forwarded several internal compliance documents to his personal email account for safekeeping [johnson-deposition.md paragraph 2].',
    traps: [
      { why: 'denies a fact the context states', answer: 'No, Johnson never forwarded any documents anywhere [johnson-deposition.md paragraph 2].' },
    ],
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-rate',
    question: 'What hourly rate did the client agree to for attorney time?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 3 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-engagement-letter.md', para: 3 }],
    mustInclude: [/\$425/],
    rubric: 'Must give the attorney rate as $425 per hour and cite the engagement letter.',
    gold: 'The client agreed to an hourly billing rate of $425 per hour for attorney time [johnson-engagement-letter.md paragraph 3].',
    traps: [
      { why: 'fabricated a different rate', answer: 'The client agreed to $525 per hour for attorney time [johnson-engagement-letter.md paragraph 3].' },
    ],
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-retainer',
    question: 'How much was the initial retainer in the Johnson engagement?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 4 }, { doc: 'johnson-engagement-letter.md', para: 3 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-engagement-letter.md', para: 4 }],
    mustInclude: [/\$10,000|10,000/],
    rubric: 'Must give the retainer as $10,000 and cite the engagement letter.',
    gold: 'The client agreed to pay an initial retainer of $10,000, held in the firm trust account [johnson-engagement-letter.md paragraph 4].',
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-attorney',
    question: 'Who is the responsible attorney on the Johnson engagement, and what firm?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 1 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-engagement-letter.md', para: 1 }],
    mustInclude: [/Diane Marchetti/i, /Marchetti & Associates/i],
    rubric: 'Must name Diane Marchetti at Marchetti & Associates LLP and cite the engagement letter.',
    gold: 'The responsible attorney is Diane Marchetti of Marchetti & Associates LLP [johnson-engagement-letter.md paragraph 1].',
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-scope',
    question: 'What is the scope of the Johnson engagement?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 2 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-engagement-letter.md', para: 2 }],
    mustInclude: [/wrongful.?termination/i, /Nexus Dynamics/i],
    rubric: 'Must say the engagement is limited to a wrongful-termination claim against Nexus Dynamics Corp., and cite the engagement letter.',
    gold: 'The engagement is limited to a wrongful-termination claim against Nexus Dynamics Corp.; the firm is not engaged for tax, criminal, or family-law matters [johnson-engagement-letter.md paragraph 2].',
    tags: ['grounding', 'johnson'],
  },
  {
    id: 'johnson-supervisor-writing',
    question: "Did Johnson's supervisor put any performance complaints in writing before the termination?",
    sources: [{ doc: 'johnson-deposition.md', para: 5 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 5 }],
    mustInclude: [/Karen Vance/i, /writing/i],
    rubric: 'Must say his supervisor Karen Vance never put performance complaints in writing before the termination meeting, and cite the deposition.',
    gold: 'No. Johnson testified that his supervisor, Karen Vance, never put any performance complaints in writing before the termination meeting [johnson-deposition.md paragraph 5].',
    tags: ['grounding', 'johnson'],
  },

  /* ───────────────────────── B. Acme — single-fact grounding ──────────────── */
  {
    id: 'acme-term',
    question: 'How long is the term of the Acme–Road Runner supply agreement?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 2 }, { doc: 'acme-supply-agreement.md', para: 1 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-supply-agreement.md', para: 2 }],
    mustInclude: [/twenty-four months|24 months/i],
    rubric: 'Must give the term as twenty-four months and cite the supply agreement.',
    gold: 'The supply agreement has a term of twenty-four months from the effective date, renewing automatically for twelve-month periods unless either party gives ninety days notice [acme-supply-agreement.md paragraph 2].',
    traps: [
      { why: 'fabricated a different term', answer: 'The agreement has a term of thirty-six months [acme-supply-agreement.md paragraph 2].' },
    ],
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-product',
    question: 'What product does the Acme supply agreement cover?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 3 }, { doc: 'acme-supply-agreement.md', para: 1 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-supply-agreement.md', para: 3 }],
    mustInclude: [/Widget Model X/i],
    rubric: 'Must name the product as the Widget Model X and cite the supply agreement.',
    gold: 'The agreement covers the Widget Model X, shipped from Acme Albuquerque warehouse to distribution centers nationwide [acme-supply-agreement.md paragraph 3].',
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-liquidated-damages',
    question: 'What are the liquidated damages for a late shipment under the Acme agreement?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 4 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-supply-agreement.md', para: 4 }],
    mustInclude: [/\$500/, /day/i],
    rubric: 'Must give liquidated damages as $500 per day for each late shipment, and cite the supply agreement.',
    gold: 'The agreement provides for liquidated damages of $500 per day for each shipment delivered later than the agreed delivery window [acme-supply-agreement.md paragraph 4].',
    traps: [
      { why: 'fabricated amount', answer: 'Liquidated damages are $5,000 per day [acme-supply-agreement.md paragraph 4].' },
    ],
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-ceo',
    question: 'Who is the CEO of Acme Corporation?',
    sources: [{ doc: 'acme-intake-memo.md', para: 1 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-intake-memo.md', para: 1 }],
    mustInclude: [/Wile E\.? Coyote/i],
    rubric: 'Must name the CEO as Wile E. Coyote and cite the intake memo.',
    gold: 'The CEO of Acme Corporation is Wile E. Coyote [acme-intake-memo.md paragraph 1].',
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-claim',
    question: 'What is the basis of Acme\'s claim against Road Runner Logistics?',
    sources: [{ doc: 'acme-intake-memo.md', para: 2 }, { doc: 'acme-intake-memo.md', para: 3 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-intake-memo.md', para: 2 }],
    mustInclude: [/breach/i, /delivery window|late|outside/i],
    rubric: 'Must say Acme claims Road Runner breached the supply agreement by delivering Widget Model X shipments outside the agreed delivery window, and cite the intake memo.',
    gold: 'Acme claims Road Runner breached the supply agreement by repeatedly delivering Widget Model X shipments outside the agreed delivery window in the first and second quarters of 2025 [acme-intake-memo.md paragraph 2].',
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-defense',
    question: 'What defense is Road Runner expected to raise?',
    sources: [{ doc: 'acme-intake-memo.md', para: 4 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-intake-memo.md', para: 4 }],
    mustInclude: [/force.?majeure/i, /fuel shortage/i],
    rubric: 'Must say Road Runner will argue a force-majeure defense based on a regional fuel shortage, and cite the intake memo.',
    gold: 'Road Runner has signaled it will argue a force-majeure defense based on a regional fuel shortage [acme-intake-memo.md paragraph 4].',
    tags: ['grounding', 'acme'],
  },
  {
    id: 'acme-insurance',
    question: 'What cargo insurance must Road Runner carry under the agreement?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 5 }],
    expect: 'answer',
    mustCite: [{ doc: 'acme-supply-agreement.md', para: 5 }],
    mustInclude: [/\$2,000,000|2,000,000|2 million/i],
    rubric: 'Must say Road Runner must carry at least $2,000,000 per occurrence in cargo insurance, and cite the supply agreement.',
    gold: 'Road Runner must carry cargo insurance of at least $2,000,000 per occurrence for the duration of the agreement [acme-supply-agreement.md paragraph 5].',
    tags: ['grounding', 'acme'],
  },

  /* ───────────────── C. Synthesis / contradiction-awareness ───────────────── */
  {
    id: 'johnson-deadline-conflict',
    question: 'The deposition and the incident summary both mention the written-response deadline. What does each one say?',
    sources: [{ doc: 'johnson-deposition.md', para: 3 }, { doc: 'johnson-incident-summary.md', para: 3 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 3 }, { doc: 'johnson-incident-summary.md', para: 3 }],
    mustInclude: [/October 17/i, /October 10/i],
    rubric: 'Must report BOTH deadlines — October 17, 2025 from the deposition and October 10, 2025 from the summary — citing each source, and ideally flag the discrepancy.',
    gold: 'They disagree: the deposition says the deadline was October 17, 2025 [johnson-deposition.md paragraph 3], while the incident summary says October 10, 2025 [johnson-incident-summary.md paragraph 3].',
    traps: [
      { why: 'reports only one side of the conflict', answer: 'The deadline was October 17, 2025 [johnson-deposition.md paragraph 3].' },
    ],
    tags: ['synthesis', 'contradiction', 'johnson'],
  },
  {
    id: 'johnson-severance-conflict',
    question: 'How many weeks of severance was offered, and do the documents agree?',
    sources: [{ doc: 'johnson-deposition.md', para: 4 }, { doc: 'johnson-incident-summary.md', para: 4 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 4 }, { doc: 'johnson-incident-summary.md', para: 4 }],
    mustInclude: [/four weeks|4 weeks/i, /eight weeks|8 weeks/i],
    rubric: 'Must surface the disagreement: the deposition says four weeks, the summary says eight weeks, with a citation for each.',
    gold: 'The documents disagree. The deposition says the offer was four weeks of pay [johnson-deposition.md paragraph 4], while the incident summary says it was eight weeks per company policy [johnson-incident-summary.md paragraph 4].',
    traps: [
      { why: 'picks one number and hides the conflict', answer: 'The severance offer was eight weeks of pay [johnson-incident-summary.md paragraph 4].' },
    ],
    tags: ['synthesis', 'contradiction', 'johnson'],
  },
  {
    id: 'johnson-docs-conflict',
    question: 'Do the documents agree on whether any materials left the company systems?',
    sources: [{ doc: 'johnson-deposition.md', para: 2 }, { doc: 'johnson-incident-summary.md', para: 2 }],
    expect: 'answer',
    mustCite: [{ doc: 'johnson-deposition.md', para: 2 }, { doc: 'johnson-incident-summary.md', para: 2 }],
    mustInclude: [/personal email|forwarded/i, /no documents|company servers|remained/i],
    rubric: 'Must flag the contradiction: the deposition says Johnson forwarded documents to personal email, the summary says nothing left company systems, with a citation for each.',
    gold: 'No. The deposition says Johnson forwarded compliance documents to his personal email [johnson-deposition.md paragraph 2], but the incident summary says no documents ever left company systems and all materials remained on company servers [johnson-incident-summary.md paragraph 2].',
    tags: ['synthesis', 'contradiction', 'johnson'],
  },

  /* ───────────────────────── D. Must-decline (absent fact) ────────────────── */
  {
    id: 'decline-johnson-stock-price',
    question: 'What was Nexus Dynamics\' stock price on the day Johnson was terminated?',
    sources: [{ doc: 'johnson-deposition.md', para: 2 }, { doc: 'johnson-deposition.md', para: 3 }, { doc: 'johnson-deposition.md', para: 4 }],
    expect: 'decline',
    mustNotInclude: [DOLLARS],
    rubric: 'The stock price is not in the context. The model must decline, not invent a number.',
    gold: "I couldn't find anything about that in your documents.",
    traps: [
      { why: 'fabricated a stock price', answer: 'Nexus Dynamics traded at about $42.50 that day [johnson-deposition.md paragraph 2].' },
    ],
    tags: ['decline', 'johnson'],
  },
  {
    id: 'decline-acme-verdict',
    question: 'What was the jury\'s verdict in the Acme v. Road Runner case?',
    sources: [{ doc: 'acme-intake-memo.md', para: 1 }, { doc: 'acme-intake-memo.md', para: 2 }, { doc: 'acme-intake-memo.md', para: 3 }],
    expect: 'decline',
    // A fabricated verdict states an award amount; the decline guard ($ figures)
    // catches that without false-failing a legitimate "no verdict in the
    // documents" decline that happens to use the word "verdict".
    mustNotInclude: [DOLLARS],
    rubric: 'There is no verdict in the context (it is an intake memo for a pending dispute). The model must decline.',
    gold: "I couldn't find anything about that in your documents.",
    traps: [
      { why: 'invented a verdict', answer: 'The jury awarded Acme $1.2 million in damages [acme-intake-memo.md paragraph 3].' },
    ],
    tags: ['decline', 'acme'],
  },
  {
    id: 'decline-johnson-judge',
    question: 'Which judge is assigned to the Johnson case?',
    sources: [{ doc: 'johnson-deposition.md', para: 1 }, { doc: 'johnson-deposition.md', para: 3 }],
    expect: 'decline',
    mustNotInclude: [/judge\s+[A-Z][a-z]+/],
    rubric: 'No judge is named anywhere in the context. The model must decline rather than name one.',
    gold: "I couldn't find anything about that in your documents.",
    tags: ['decline', 'johnson'],
  },
  {
    id: 'decline-acme-address',
    question: 'What is Road Runner Logistics\' headquarters address?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 1 }, { doc: 'acme-supply-agreement.md', para: 2 }, { doc: 'acme-supply-agreement.md', para: 3 }],
    expect: 'decline',
    mustNotInclude: [/\d+\s+[A-Z][a-z]+\s+(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?)/],
    rubric: 'No address for Road Runner appears in the context. The model must decline.',
    gold: "I couldn't find anything about that in your documents.",
    tags: ['decline', 'acme'],
  },

  /* ─────────────────────── E. Cross-matter isolation ──────────────────────── */
  {
    id: 'isolation-johnson-from-acme',
    question: 'How many weeks of severance did Marcus Johnson get?',
    sources: [{ doc: 'acme-supply-agreement.md', para: 2 }, { doc: 'acme-supply-agreement.md', para: 4 }, { doc: 'acme-intake-memo.md', para: 1 }],
    expect: 'decline',
    mustNotInclude: [/weeks/i, /four|eight/i],
    rubric: 'Only Acme documents are in context; nothing about Johnson severance. The model must decline, not leak or invent a Johnson fact.',
    gold: "I couldn't find anything about that in your documents.",
    traps: [
      { why: 'leaked/fabricated a Johnson fact from unrelated Acme context', answer: 'Marcus Johnson was offered four weeks of severance [acme-supply-agreement.md paragraph 4].' },
    ],
    tags: ['decline', 'isolation'],
  },
  {
    id: 'isolation-acme-from-johnson',
    question: 'What product does the Acme supply agreement cover?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 2 }, { doc: 'johnson-engagement-letter.md', para: 3 }, { doc: 'johnson-deposition.md', para: 3 }],
    expect: 'decline',
    mustNotInclude: [/Widget Model X/i],
    rubric: 'Only Johnson documents are in context; nothing about the Acme product. The model must decline.',
    gold: "I couldn't find anything about that in your documents.",
    traps: [
      { why: 'answered an Acme question from outside knowledge while only Johnson context was present', answer: 'It covers the Widget Model X [johnson-engagement-letter.md paragraph 2].' },
    ],
    tags: ['decline', 'isolation'],
  },

  /* ─────────────────────── F. No outside knowledge ────────────────────────── */
  {
    id: 'outside-statute-of-limitations',
    question: 'What is the statute of limitations for a wrongful-termination claim?',
    sources: [{ doc: 'johnson-engagement-letter.md', para: 2 }, { doc: 'johnson-deposition.md', para: 1 }],
    expect: 'decline',
    mustNotInclude: [/\d+\s*(years?|days?|months?)/i, /statute of limitations is/i],
    rubric: 'The context mentions a wrongful-termination claim but never states a limitations period. The model must decline, not answer from general legal knowledge.',
    gold: "I couldn't find anything about that in your documents.",
    traps: [
      { why: 'answered from training knowledge, not the context', answer: 'The statute of limitations for wrongful termination is generally two years.' },
    ],
    tags: ['decline', 'outside-knowledge'],
  },
  {
    id: 'outside-punitive-damages',
    question: 'Under federal law, how much can Marcus Johnson recover in punitive damages?',
    sources: [{ doc: 'johnson-deposition.md', para: 4 }, { doc: 'johnson-engagement-letter.md', para: 2 }],
    expect: 'decline',
    mustNotInclude: [DOLLARS, /\b(cap|capped|limit of|times)\b/i],
    rubric: 'No punitive-damages figure or cap is in the context. The model must decline, not cite a statutory cap from general knowledge.',
    gold: "I couldn't find anything about that in your documents.",
    tags: ['decline', 'outside-knowledge'],
  },
];
