// src/clientmap-design/richFixture.ts
//
// DESIGN-ONLY fixture: a complete, busy Client Map to iterate the real
// ClientMapPanel / ClientMapView design against. NOT shipped in the app — it is
// only imported by the `clientmap-design.html` dev harness. Every one of the
// five core sections is richly populated with cited items, plus a custom
// section, working assumptions, and a full completeness (know / assuming / ask)
// block — so design decisions are made against a FULL map, not a sparse one.
//
// The household is the Webb family (same as the public web demo) so the content
// reads like a real advisor's working file.

import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  CoreSectionKey,
  SourceRef,
} from '@/platform/clientMap/types';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';

export const DESIGN_MATTER_ID = 'matter_design_clientmap';
export const DESIGN_CLIENT_NAME = 'Webb Household — Marcus & Tanya Webb';

const TS = '2026-06-29T16:00:00.000Z';
const DIR = '/Webb Household';

let seq = 0;
function item(
  text: string,
  sources: SourceRef[] = [],
  opts: { isAssumption?: boolean; origin?: 'ai' | 'user' } = {},
): ClientMapItem {
  seq += 1;
  return {
    id: `cm-${String(seq)}`,
    text,
    origin: opts.origin ?? 'ai',
    isAssumption: opts.isAssumption ?? false,
    sources,
    updatedAt: TS,
  };
}

// ── Source helpers (varied kinds so the chips look like a real file) ──────────
function doc(file: string, snippet: string, locator?: string): SourceRef {
  const out: SourceRef = { kind: 'document', ref: `${DIR}/${file}`, snippet };
  if (locator !== undefined) out.locator = locator;
  return out;
}
function email(snippet: string): SourceRef {
  return { kind: 'email', ref: 'mail:webb-thread-2026', snippet };
}
function meeting(snippet: string): SourceRef {
  return { kind: 'meeting', ref: 'meeting:webb-discovery', snippet, locator: 'notes' };
}

const PLAN = 'Financial Plan Summary.md';
const NOTES = 'Review Notes.md';
const BENE = 'Beneficiary Designations.md';
const INTAKE = 'Client Intake Summary.md';

// ── The five core sections ────────────────────────────────────────────────────
function coreSections(): ClientMapSection[] {
  // The four approved buckets: Household, Goals, Money and accounts, Follow-ups
  // (the dated "Coming up" events were folded into Follow-ups).
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    // Household — who they are, their life, and the people around them.
    household: [
      item('Marcus (38) and Tanya (37) Webb — married, with two young children, Caleb (8) and Ava (5).', [doc(PLAN, 'Clients: Marcus Webb (38) and Tanya Webb (37). Dependents: Caleb (8), Ava (5)', 'p. 1')]),
      item('Marcus changed employers last year — the job change kicked off the rollover, and he is the primary decision-maker.', [email('Now that the new job is settled, can we finally deal with the old 401(k)?')]),
      item('They switched advisors after a friend’s planner missed a beneficiary problem — trust is the whole reason they moved.', [meeting('Came in burned by the last advisor; they want someone who catches the things they would miss.')]),
      item('Dana Liu, their CPA, coordinates tax timing; no estate attorney for the will and guardianship is engaged yet.', [doc(INTAKE, 'Coordinate the Roth conversion timing with their CPA (Dana Liu). No estate attorney on file.')]),
      item('Jessica Reyes — Marcus’s first wife (divorced 2019); still named on the old 401(k).', [doc(BENE, 'Old 401(k) (prior employer) | Marcus | Jessica Reyes (100%) … dated 2019')]),
      item('Tanya’s mother (78) may need care help in the next few years — mentioned once, not yet planned for.', [meeting('Tanya brought up her mom’s health; could become a cost down the road.')], { isAssumption: true }),
    ],
    // Goals — what they want, values, and risk attitude (no dates, no balances).
    goals: [
      item('Retire by 60.', [doc(INTAKE, 'Goal: retire by 60.')]),
      item('Get both kids through college without loans.', [doc(INTAKE, 'Get both kids through college without loans.')]),
      item('Pay off the house early.', [doc(PLAN, 'Goals: retire at 60, fund both kids’ college, pay off the house early')]),
      item('Stop worrying every market dip — moderate-growth risk profile confirmed on the March 2026 questionnaire.', [doc(PLAN, 'Risk profile: Moderate growth (completed questionnaire, March 2026)', 'p. 3')]),
      item('They want plain-English explanations, not jargon — they read every statement together.', [meeting('Both of them read every statement. Keep it in plain language.')]),
    ],
    // Money and accounts — where the money stands today (facts; fix-its are Follow-ups).
    money: [
      item('Marcus’s 401(k): $412,000, contributing 12% with a 4% match.', [doc(PLAN, 'Marcus 401(k): $412,000, contributing 12% plus a 4% match', 'p. 4')]),
      item('Old employer 401(k): $96,000 still at the prior custodian, not yet rolled over.', [doc(PLAN, 'Old employer 401(k) of $96,000 still sitting at the prior custodian, not yet rolled over')]),
      item('Tanya’s 403(b): $188,000 at 9%; joint brokerage $145,000, mostly index funds.', [doc(PLAN, 'Tanya 403(b): $188,000, contributing 9%. Joint brokerage: $145,000, mostly index funds')]),
      item('Roth IRAs $61,000 (Marcus) and $54,000 (Tanya); 529s $48,000 (Caleb) and $29,000 (Ava).', [doc(PLAN, 'Roth IRAs: $61,000 (Marcus), $54,000 (Tanya). 529 plans: $48,000 (Caleb), $29,000 (Ava)')]),
      item('Cash reserve $55,000 (about five months); mortgage $318,000 at 5.1% with 26 years left.', [doc(PLAN, 'Cash reserve: $55,000 (about 5 months of expenses). Mortgage: $318,000 at 5.1%, 26 years left', 'p. 5')]),
      item('Stale beneficiary: the old 401(k) still names Marcus’s ex-wife, not Tanya.', [doc(BENE, 'still lists Jessica Reyes, Marcus’s first wife, as the sole primary beneficiary, dated 2019')]),
      item('Combined income looks to be around $245,000; the effective tax bracket is still pending the CPA’s confirmation.', [email('Ballpark our bracket for the Roth math — Dana to confirm the exact number.')], { isAssumption: true }),
    ],
    // Follow-ups — the advisor's open items, promises, and dated next steps.
    followups: [
      item('Year-end: decide the Roth conversion amount with the CPA.', [doc(PLAN, 'Decide on the Roth conversion amount before year-end.')]),
      item('Before December: top up the 529s to capture the state tax deduction.', [doc(PLAN, 'Top up the 529s before December to capture the state tax deduction.')]),
      item('Fall: the next scheduled annual review.', [email('Book the fall review; send the agenda early so they come prepared.')]),
      item('This quarter: close out the old-401(k) rollover.', [doc(NOTES, 'The old 401(k) rollover is the priority, it’s been sitting too long.')]),
      item('Fall meeting: review term-life coverage levels — likely light for two kids and a mortgage.', [email('Add life insurance to the fall agenda; I think they’re under-covered.')]),
      item('Start the rollover paperwork and confirm the receiving IRA.', [doc(PLAN, 'Confirm the rollover paperwork and the receiving account.')]),
      item('Send Marcus the beneficiary-change form for the old 401(k).', [doc(BENE, 'If he died before the rollover, that account would pass to his ex-spouse, not to Tanya.')]),
      item('Confirm every beneficiary row against the custodian’s record, not the client’s memory.', [doc(BENE, 'Confirm every row against the custodian, not the client’s memory.')]),
      item('Set up the $400/month brokerage auto-contribution after Tanya’s raise.', [doc(NOTES, 'Increase the joint brokerage auto-contribution by $400/month.')]),
      item('Settle the Roth conversion amount before December.', [doc(NOTES, 'Revisit the Roth conversion before December.')]),
      item('Send the term-life quote request to the brokerage desk.', [email('Pull term quotes: $1M on Marcus, $750k on Tanya, 20-year level.')]),
    ],
  };
  return CORE_SECTION_ORDER.map((key) => ({
    id: key,
    kind: 'core' as const,
    key,
    title: CORE_SECTION_TITLE[key],
    items: byKey[key],
  }));
}

// ── A custom section (shows the custom-section UI in a busy map) ───────────────
function insuranceSection(): ClientMapSection {
  return {
    id: 'sec_insurance',
    kind: 'custom',
    key: 'sec_insurance',
    title: 'Insurance coverage',
    prompt: 'policy types, coverage limits, and renewal dates',
    scope: 'matter',
    items: [
      item('Term life — Marcus $500k and Tanya $250k, both 20-year level policies issued in 2021.', [doc(INTAKE, 'Term life: Marcus $500,000 / Tanya $250,000, 20-year level, issued 2021')]),
      item('Homeowner’s policy renews in March; dwelling coverage is $410,000.', [doc(INTAKE, 'Homeowner’s: dwelling $410,000, renews March')]),
      item('Auto policies are bundled with the same homeowner’s carrier.', [doc(INTAKE, 'Auto bundled with the home carrier for the multi-policy discount.')]),
      item('No umbrella liability policy on file — a gap given two earners and a teen driver before long.', [], { isAssumption: true }),
      item('Disability: Marcus has group long-term disability through work; Tanya’s coverage is unknown.', [email('Confirm whether Tanya’s employer offers LTD.')], { isAssumption: true }),
    ],
  };
}

// ── Completeness block: know / assuming / ask ─────────────────────────────────
function knowItems(): ClientMapItem[] {
  return [
    item('The old 401(k) still names Marcus’s ex-wife, Jessica Reyes, as 100% primary beneficiary — a stale 2019 form.', [doc(BENE, 'still lists Jessica Reyes, Marcus’s first wife, as the sole primary beneficiary, dated 2019')]),
    item('Rolling the $96,000 old 401(k) into a Marcus IRA is the standing priority.', [doc(NOTES, 'Roll the old 401(k) into Marcus’s IRA. I’ll start the paperwork.')]),
    item('After Tanya’s raise, $400/month more is going into the joint brokerage.', [doc(NOTES, 'They can push another $400/month into savings.')]),
    item('About five months of expenses sit in the $55,000 cash reserve.', [doc(PLAN, 'Cash reserve: $55,000 (about 5 months of expenses)')]),
    item('Headline goals: retire at 60 and fund both kids through college.', [doc(PLAN, 'Goals: Retire at 60, fund both kids’ college, pay off the house early')]),
  ];
}
function assumingItems(): ClientMapItem[] {
  return [
    item('No estate attorney engaged yet for the will and guardianship.', [], { isAssumption: true }),
    item('Term-life coverage looks light for two kids and a $318k mortgage.', [doc(INTAKE, 'Term life: Marcus $500,000 / Tanya $250,000')], { isAssumption: true }),
    item('Effective tax bracket assumed around 24% pending the CPA’s confirmation.', [email('Dana to confirm the exact bracket for the Roth math.')], { isAssumption: true }),
    item('No umbrella liability policy on file.', [], { isAssumption: true }),
  ];
}

export function buildDesignClientMap(): ClientMap {
  seq = 0; // deterministic ids each build
  return {
    matterId: DESIGN_MATTER_ID,
    sections: [...coreSections(), insuranceSection()],
    completeness: {
      level: 'getting-there',
      know: knowItems(),
      assuming: assumingItems(),
      ask: [
        { text: 'Confirm the receiving IRA custodian for the old-401(k) rollover.', sectionKey: 'followups' },
        { text: 'Does Tanya’s employer offer long-term disability coverage?', sectionKey: 'money' },
        { text: 'Has an estate attorney been engaged for the will and guardianship?', sectionKey: 'household' },
        { text: 'Confirm the household’s effective tax bracket with the CPA.', sectionKey: 'money' },
        { text: 'Do they want an umbrella liability policy quote?', sectionKey: 'sec_insurance' },
      ],
    },
    pendingUpdates: [],
    lastBuiltAt: TS,
    lastSourceFingerprint: 'design-fixture-webb',
  };
}
