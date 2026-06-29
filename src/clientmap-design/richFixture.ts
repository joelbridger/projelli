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
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    story: [
      item('Became clients in September 2025 for comprehensive financial planning plus ongoing investment management.', [doc(INTAKE, 'Date opened: 2025-09-04 — Comprehensive financial planning + ongoing investment management')]),
      item('Marcus (38) and Tanya (37) Webb — married, with two young children, Caleb (8) and Ava (5).', [doc(PLAN, 'Clients: Marcus Webb (38) and Tanya Webb (37). Dependents: Caleb (8), Ava (5)', 'p. 1')]),
      item('What they want: retire by 60, get both kids through college without loans, and stop worrying every market dip.', [doc(INTAKE, 'Retire by 60, get both kids through college without loans, and stop worrying every time the market dips')]),
      item('They switched advisors after a friend’s planner missed a beneficiary problem — trust is the whole reason they moved.', [meeting('Came in burned by the last advisor; they want someone who catches the things they would miss.')]),
      item('Risk profile confirmed moderate growth on the March 2026 questionnaire.', [doc(PLAN, 'Risk profile: Moderate growth (completed questionnaire, March 2026)', 'p. 3')]),
      item('Marcus changed employers last year — the job change is what kicked off both the rollover and the beneficiary review.', [email('Now that the new job is settled, can we finally deal with the old 401(k)?')]),
      item('They review the portfolio together once a month and want plain-English explanations, not jargon.', [meeting('Both of them read every statement. Keep it in plain language.')]),
    ],
    people: [
      item('Marcus Webb — 38, changed jobs last year; the primary decision-maker on the rollover.', [doc(NOTES, 'Marcus changed jobs last year. The $96k from the old employer 401(k) is still at the prior custodian.')]),
      item('Tanya Webb — 37; just got a raise that frees up about $400/month for savings.', [doc(NOTES, 'Tanya got a raise. They can push another $400/month into savings.')]),
      item('Caleb (8) and Ava (5) — the two children both 529 plans are funding.', [doc(PLAN, '529 plans: $48,000 (Caleb), $29,000 (Ava)', 'p. 2')]),
      item('Jessica Reyes — Marcus’s first wife (divorced 2019); still the 100% primary beneficiary on the old 401(k).', [doc(BENE, 'Old 401(k) (prior employer) | Marcus | Jessica Reyes (100%) … dated 2019')]),
      item('Dana Liu, their CPA — coordinates the timing of any Roth conversion before it is executed.', [doc(INTAKE, 'Coordinate the Roth conversion timing with their CPA (Dana Liu) before executing.')]),
      item('An estate attorney for the will and guardianship has not been engaged yet.', [], { isAssumption: true }),
      item('Tanya’s mother (78) may need care help in the next few years — mentioned once, not yet planned for.', [meeting('Tanya brought up her mom’s health; could become a cost down the road.')], { isAssumption: true }),
    ],
    standing: [
      item('Marcus’s current 401(k): $412,000, contributing 12% with a 4% match.', [doc(PLAN, 'Marcus 401(k): $412,000, contributing 12% plus a 4% match', 'p. 4')]),
      item('Old employer 401(k): $96,000 still at the prior custodian, not yet rolled over.', [doc(PLAN, 'Old employer 401(k) of $96,000 still sitting at the prior custodian, not yet rolled over')]),
      item('Tanya’s 403(b): $188,000 at 9%; joint brokerage $145,000, mostly index funds.', [doc(PLAN, 'Tanya 403(b): $188,000, contributing 9%. Joint brokerage: $145,000, mostly index funds')]),
      item('Roth IRAs $61,000 (Marcus) and $54,000 (Tanya); 529s $48,000 (Caleb) and $29,000 (Ava).', [doc(PLAN, 'Roth IRAs: $61,000 (Marcus), $54,000 (Tanya). 529 plans: $48,000 (Caleb), $29,000 (Ava)')]),
      item('Cash reserve $55,000 (about five months); mortgage $318,000 at 5.1% with 26 years left.', [doc(PLAN, 'Cash reserve: $55,000 (about 5 months of expenses). Mortgage: $318,000 at 5.1%, 26 years left', 'p. 5')]),
      item('Combined income looks to be around $245,000; the effective tax bracket is still pending the CPA’s confirmation.', [email('Ballpark our bracket for the Roth math — Dana to confirm the exact number.')], { isAssumption: true }),
    ],
    upcoming: [
      item('Old 401(k) rollover into a Marcus IRA — the priority; it has been sitting too long.', [doc(NOTES, 'The old 401(k) rollover is the priority, it’s been sitting too long.')]),
      item('Joint brokerage auto-contribution increasing by $400/month after Tanya’s raise.', [doc(NOTES, 'Increase the joint brokerage auto-contribution by $400/month.')]),
      item('Year-end decision on the Roth conversion amount, coordinated with the CPA.', [doc(PLAN, 'Decide on the Roth conversion amount before year-end.')]),
      item('A full beneficiary recheck across every account, flagged personally after the divorce comment.', [doc(NOTES, 'Recheck every beneficiary designation. Marcus’s comment about the divorce is exactly why.')]),
      item('Review term-life coverage levels at the fall meeting — likely light for two kids and a mortgage.', [email('Add life insurance to the fall agenda; I think they’re under-covered.')]),
      item('529 contribution top-up before year-end to capture the state deduction.', [doc(PLAN, 'Top up the 529s before December to capture the state tax deduction.')]),
    ],
    next: [
      item('Start the rollover paperwork and confirm the receiving IRA.', [doc(PLAN, 'Confirm the rollover paperwork and the receiving account.')]),
      item('Fix the stale old-401(k) beneficiary — it still names Marcus’s ex-wife, Jessica Reyes, not Tanya.', [doc(BENE, 'If he died before the rollover, that account would pass to his ex-spouse, not to Tanya.')]),
      item('Confirm every beneficiary row against the custodian’s record, not the client’s memory.', [doc(BENE, 'Confirm every row against the custodian, not the client’s memory.')]),
      item('Settle the Roth conversion amount before December.', [doc(NOTES, 'Revisit the Roth conversion before December.')]),
      item('Send the term-life quote request to the brokerage desk.', [email('Pull term quotes: $1M on Marcus, $750k on Tanya, 20-year level.')]),
      item('Schedule the fall review and share the agenda a week ahead.', [email('Book the fall review; send the agenda early so they come prepared.')]),
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
        { text: 'Confirm the receiving IRA custodian for the old-401(k) rollover.', sectionKey: 'next' },
        { text: 'Does Tanya’s employer offer long-term disability coverage?', sectionKey: 'standing' },
        { text: 'Has an estate attorney been engaged for the will and guardianship?', sectionKey: 'people' },
        { text: 'Confirm the household’s effective tax bracket with the CPA.', sectionKey: 'standing' },
        { text: 'Do they want an umbrella liability policy quote?', sectionKey: 'sec_insurance' },
      ],
    },
    pendingUpdates: [],
    lastBuiltAt: TS,
    lastSourceFingerprint: 'design-fixture-webb',
  };
}
