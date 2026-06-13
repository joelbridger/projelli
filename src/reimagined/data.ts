/**
 * Mock data for the reimagined-UI prototype. Realistic litigation content so
 * the design can be judged against real practice. No real people or matters.
 */

export type MatterStatus = 'open' | 'pending' | 'closed';
export type Confidentiality = 'local' | 'direct' | 'assured';

export interface Matter {
  id: string;
  title: string;
  client: string;
  number: string;
  status: MatterStatus;
  area: string;
  attorney: string;
  lastActivity: string;
  docs: number;
  emails: number;
  drafts: number;
  confidentiality: Confidentiality;
}

export interface Citation {
  n: number;
  doc: string;
  locator: string; // e.g. "Dep. 84:12" or "Ex. 14, p. 3"
  excerpt: string;
  date: string;
  verified: boolean;
}

export interface Contradiction {
  id: string;
  topic: string;
  depoLocator: string;
  depoQuote: string;
  priorDoc: string;
  priorLocator: string;
  priorQuote: string;
  summary: string;
  status: 'use' | 'review' | 'reject';
  verified: boolean;
}

export interface DocRow {
  id: string;
  name: string;
  kind: 'Deposition' | 'Production' | 'Email' | 'Draft' | 'Pleading' | 'Correspondence';
  date: string;
  author: string;
  analyzed: boolean;
  privileged: boolean;
}

export const FIRM = 'Marchetti Law';
export const ATTORNEY = { name: 'Diane Marchetti', initials: 'DM' };

export const MATTERS: Matter[] = [
  {
    id: 'brennan',
    title: 'Brennan v. Vanguard Logistics',
    client: 'Michael Brennan',
    number: '2026-0142',
    status: 'open',
    area: 'Employment',
    attorney: 'D. Marchetti',
    lastActivity: '20 min ago',
    docs: 1847,
    emails: 312,
    drafts: 4,
    confidentiality: 'local',
  },
  {
    id: 'castellano',
    title: 'Castellano v. Meridian Insurance',
    client: 'Rosa Castellano',
    number: '2026-0118',
    status: 'open',
    area: 'Insurance / Bad faith',
    attorney: 'D. Marchetti',
    lastActivity: '2 hours ago',
    docs: 642,
    emails: 208,
    drafts: 2,
    confidentiality: 'direct',
  },
  {
    id: 'okafor',
    title: 'Okafor v. Riverside Dental Group',
    client: 'Adaeze Okafor',
    number: '2026-0097',
    status: 'open',
    area: 'Personal injury',
    attorney: 'D. Marchetti',
    lastActivity: 'Yesterday',
    docs: 388,
    emails: 144,
    drafts: 1,
    confidentiality: 'local',
  },
  {
    id: 'lin',
    title: 'Estate of Howard Lin',
    client: 'Grace Lin, Executor',
    number: '2026-0061',
    status: 'pending',
    area: 'Probate',
    attorney: 'D. Marchetti',
    lastActivity: '3 days ago',
    docs: 156,
    emails: 73,
    drafts: 0,
    confidentiality: 'local',
  },
  {
    id: 'talbot',
    title: 'Talbot Holdings LLC',
    client: 'Talbot Holdings LLC',
    number: '2025-0233',
    status: 'open',
    area: 'Business advisory',
    attorney: 'D. Marchetti',
    lastActivity: 'Last week',
    docs: 91,
    emails: 410,
    drafts: 3,
    confidentiality: 'assured',
  },
  {
    id: 'nguyen',
    title: 'Nguyen v. City of Fairview',
    client: 'Linh Nguyen',
    number: '2025-0188',
    status: 'closed',
    area: 'Civil rights',
    attorney: 'D. Marchetti',
    lastActivity: 'Mar 2026',
    docs: 2204,
    emails: 96,
    drafts: 0,
    confidentiality: 'local',
  },
];

export const ACTIVE_MATTER_ID = 'brennan';
export const activeMatter = MATTERS[0];

/** The wedge: a plain-English question with a cited answer. */
export const ASK_EXAMPLE = {
  question: 'Did Vanguard ever document that Brennan’s performance was satisfactory before the termination?',
  // Answer text uses {n} markers where citation chips render inline.
  answer:
    'Yes. The record shows three points where Vanguard treated Brennan’s performance as satisfactory in the year before the termination. His March 2025 annual review rated him "meets expectations" in every category {1}. His supervisor, Dale Whitmore, emailed HR in May 2025 that Brennan was "solid on the floor, no real concerns" {2}. And Brennan received the quarterly safety bonus in Q2 2025, which the policy limits to employees "in good standing" {3}. This sits directly against Whitmore’s deposition testimony that Brennan had been "a problem since the day I got there" {4}.',
  citations: [
    { n: 1, doc: '2025 Annual Review — Brennan.pdf', locator: 'Ex. 14, p. 2', excerpt: 'Overall rating: Meets Expectations. Reliability: Meets. Safety: Exceeds.', date: 'Mar 14, 2025', verified: true },
    { n: 2, doc: 'Whitmore → HR (Reyes).eml', locator: 'PROD-002918', excerpt: '“Honestly he’s solid on the floor, no real concerns. Let’s keep him on the early shift.”', date: 'May 2, 2025', verified: true },
    { n: 3, doc: 'Q2 2025 Safety Bonus Roster.xlsx', locator: 'Row 41', excerpt: 'Brennan, M. — Eligible (good standing) — $750.', date: 'Jul 1, 2025', verified: true },
    { n: 4, doc: 'Whitmore Deposition.pdf', locator: 'Dep. 84:12', excerpt: '“He’d been a problem since the day I got there, frankly.”', date: 'Apr 9, 2026', verified: true },
  ] as Citation[],
};

/** The litigation associate: contradiction candidates, cited both sides. */
export const CONTRADICTIONS: Contradiction[] = [
  {
    id: 'c1',
    topic: 'Brennan’s job performance',
    depoLocator: 'Dep. 84:12',
    depoQuote: 'He’d been a problem since the day I got there, frankly.',
    priorDoc: 'Whitmore → HR (Reyes).eml',
    priorLocator: 'PROD-002918',
    priorQuote: 'Honestly he’s solid on the floor, no real concerns.',
    summary: 'Whitmore testified Brennan was a long-standing problem, but emailed HR seven weeks earlier that he had no real concerns.',
    status: 'use',
    verified: true,
  },
  {
    id: 'c2',
    topic: 'Who decided to terminate',
    depoLocator: 'Dep. 121:4',
    depoQuote: 'That call came down from corporate, not from me.',
    priorDoc: 'Termination Request Form.pdf',
    priorLocator: 'PROD-004410',
    priorQuote: 'Requested by: D. Whitmore (Floor Supervisor). Reason: performance.',
    summary: 'Whitmore testified the decision came from corporate, but he is named as the requesting manager on the termination form.',
    status: 'use',
    verified: true,
  },
  {
    id: 'c3',
    topic: 'Knowledge of the injury report',
    depoLocator: 'Dep. 97:19',
    depoQuote: 'I never saw any injury complaint from him.',
    priorDoc: 'Incident Log 2025.xlsx',
    priorLocator: 'Row 88',
    priorQuote: 'Reported to: D. Whitmore. Acknowledged 6/14.',
    summary: 'Whitmore testified he never saw an injury complaint; the incident log records he acknowledged Brennan’s report on June 14.',
    status: 'review',
    verified: true,
  },
  {
    id: 'c4',
    topic: 'Timing of the policy change',
    depoLocator: 'Dep. 63:8',
    depoQuote: 'The attendance policy was always strict, nothing changed.',
    priorDoc: 'HR Policy v4 (redline).docx',
    priorLocator: 'p. 6',
    priorQuote: 'Effective Apr 2025: unexcused absences reduced from 5 to 3.',
    summary: 'Whitmore testified the attendance policy never changed; the HR policy redline shows the threshold tightened in April 2025, one month before the write-ups began.',
    status: 'review',
    verified: false,
  },
];

export const DOCS: DocRow[] = [
  { id: 'd1', name: 'Whitmore Deposition.pdf', kind: 'Deposition', date: 'Apr 9, 2026', author: 'Veritext', analyzed: true, privileged: false },
  { id: 'd2', name: '2025 Annual Review — Brennan.pdf', kind: 'Production', date: 'Mar 14, 2025', author: 'Vanguard HR', analyzed: true, privileged: false },
  { id: 'd3', name: 'Demand Letter — draft 3.docx', kind: 'Draft', date: 'Today', author: 'D. Marchetti', analyzed: false, privileged: true },
  { id: 'd4', name: 'Whitmore → HR (Reyes).eml', kind: 'Email', date: 'May 2, 2025', author: 'D. Whitmore', analyzed: true, privileged: false },
  { id: 'd5', name: 'Engagement Letter — Brennan.docx', kind: 'Correspondence', date: 'Jan 8, 2026', author: 'D. Marchetti', analyzed: false, privileged: true },
  { id: 'd6', name: 'Production Vol. III (Bates 2400–3600).pdf', kind: 'Production', date: 'Feb 2026', author: 'Opposing counsel', analyzed: true, privileged: false },
];

export interface TimelineEntry { id: string; when: string; kind: string; text: string; }
export const TIMELINE: TimelineEntry[] = [
  { id: 't1', when: '20 min ago', kind: 'Ask', text: 'Asked: documented satisfactory performance before termination. 4 cited findings.' },
  { id: 't2', when: '1 hr ago', kind: 'Associate', text: 'Contradiction analysis run across the Whitmore deposition and production. 4 candidates.' },
  { id: 't3', when: 'Today', kind: 'Draft', text: 'Demand Letter — draft 3 created on firm letterhead.' },
  { id: 't4', when: 'Yesterday', kind: 'Index', text: 'Production Vol. III indexed: 1,200 pages, 38 scanned (OCR).' },
];

/** Trust map: per-document data handling, in plain English. */
export interface TrustRow { doc: string; storage: string; processing: string; mode: Confidentiality; }
export const TRUST_MAP: TrustRow[] = [
  { doc: 'Whitmore Deposition.pdf', storage: 'On this computer', processing: 'Indexed on this machine', mode: 'local' },
  { doc: 'Production Vol. I–III', storage: 'On this computer', processing: 'Indexed on this machine (OCR local)', mode: 'local' },
  { doc: 'Demand Letter — draft 3.docx', storage: 'On this computer (privileged)', processing: 'Not sent anywhere', mode: 'local' },
  { doc: 'Client email thread', storage: 'Encrypted on this computer', processing: 'Indexed on this machine', mode: 'local' },
];
