/**
 * seedDemoClients — dev/preview-only seed of a realistic advisor book of
 * business, so the Clients list and the redesigned client-detail screen can be
 * driven with believable content WITHOUT a cloud key or real documents.
 *
 * Gated behind `?testMode=true&seedDemo=1`. Never runs in production or in the
 * normal E2E path (which expects an empty workspace). Idempotent: if the demo
 * household already exists, it does nothing.
 */
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  CoreSectionKey,
  SourceRef,
} from '@/platform/clientMap/types';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';

const DEMO_MATTER_ID = 'matter_demo_brennan';

let itemSeq = 0;
function mkItem(text: string, sources: SourceRef[] = [], isAssumption = false): ClientMapItem {
  itemSeq += 1;
  return {
    id: `demo-it-${String(itemSeq)}`,
    text,
    origin: 'ai',
    isAssumption,
    sources,
    updatedAt: '2026-06-20T16:00:00.000Z',
  };
}
function doc(ref: string, snippet: string, locator?: string): SourceRef {
  return locator != null
    ? { kind: 'document', ref, snippet, locator }
    : { kind: 'document', ref, snippet };
}
function email(ref: string, snippet: string): SourceRef {
  return { kind: 'email', ref, snippet };
}

function brennanSections(): ClientMapSection[] {
  const D = '/test-workspace/Brennan Household';
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    household: [
      mkItem('Robert Brennan — 62, retiring dentist, primary decision-maker.'),
      mkItem('Susan Brennan — 60, spouse, former practice office manager.'),
      mkItem('Adult children: Megan (34, getting married) and Daniel (31).'),
      mkItem('CPA: Maria Alvarez, Alvarez & Co.', [email(`${D}/mail/alvarez.eml`, 'Looping in Maria on the Roth conversion…')]),
      mkItem('Estate attorney: Linda Park, Park & Wills LLP.', [doc(`${D}/Estate Plan Summary.pdf`, 'Prepared by Park & Wills LLP…', 'p. 2')]),
      mkItem('Became clients in 2019, referred by their CPA after selling stakes in two dental practices.'),
    ],
    goals: [
      mkItem('Retire fully by 2027 and seed a small family foundation.', [email(`${D}/mail/goals.eml`, 'We would love to set up a foundation for the grandkids…')]),
      mkItem('Sold the remaining practice to Heartland Dental in March 2023 for $3.8M (earn-out runs through 2025).', [doc(`${D}/Sale Agreement.pdf`, 'Purchase price of $3,800,000…', 'p. 1')]),
    ],
    money: [
      mkItem('Investable assets $4.2M; current allocation 62% equity / 38% fixed income.', [doc(`${D}/Q1 Statement.pdf`, 'Total portfolio value $4,201,880…', 'p. 3')]),
      mkItem('Roth conversion ladder underway since 2024 to fill the 24% bracket.'),
      mkItem('Concentrated position: $480k of Heartland Dental stock from the sale.', [email(`${D}/mail/concentration.eml`, 'Still holding the Heartland shares…')]),
      mkItem('Two 529 plans for the grandchildren, about $85k combined.'),
    ],
    followups: [
      mkItem('Rebalance back toward the 60/40 target.'),
      mkItem('Diversify the concentrated Heartland position over 2025–2026.'),
      mkItem('Confirm the 2026 gifting strategy with the CPA before year-end.'),
      mkItem("Robert's required minimum distributions begin 2027."),
      mkItem("Megan's wedding, spring 2026 — gifting question still open."),
      mkItem('Annual review meeting booked for May 2026.', [email(`${D}/mail/review-invite.eml`, 'Confirming our annual review for May…')]),
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

function brennanClientMap(): ClientMap {
  return {
    matterId: DEMO_MATTER_ID,
    sections: brennanSections(),
    completeness: {
      level: 'getting-there',
      know: [],
      assuming: [
        mkItem('Assuming a moderate risk tolerance — last formally confirmed in 2022.', [], true),
      ],
      ask: [
        { text: 'Has their risk tolerance changed since the practice sale?', sectionKey: 'money' },
        { text: 'Do they want to make annual-exclusion gifts to the kids before year-end?', sectionKey: 'followups' },
      ],
    },
    pendingUpdates: [],
    lastBuiltAt: '2026-06-20T16:00:00.000Z',
    lastSourceFingerprint: 'demo-fingerprint',
  };
}

function okaforSections(): ClientMapSection[] {
  const D = '/test-workspace/Okafor Household';
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    goals: [
      mkItem('Became clients in 2022, introduced by Chidi\'s former HR director at the end of his corporate career.'),
      mkItem(
        'Chidi retired from Procter & Gamble in January 2025 as VP of Operations after 28 years; rolled his $1.2M 401(k) to a Fidelity rollover IRA in March 2025.',
        [doc(`${D}/Fidelity Rollover Confirmation.pdf`, 'IRA rollover complete. Transferred assets valued at $1,198,440…', 'p. 1')],
      ),
      mkItem(
        'Ada is a practicing pediatrician at Nationwide Children\'s Hospital and plans to retire around 2031.',
        [email(`${D}/mail/ada-timeline.eml`, 'I\'m thinking five more years, give or take…')],
      ),
      mkItem(
        'Primary goals: maximize Roth conversion runway before Ada\'s income ends, fully fund Marcus and Zoe\'s college, and establish a donor-advised fund for charitable giving.',
        [email(`${D}/mail/goals-2024.eml`, 'The DAF idea feels right — we want the kids to see giving as part of the plan…')],
      ),
    ],
    household: [
      mkItem('Chidi Okafor — 58, retired VP of Operations (Procter & Gamble), primary rollover IRA account holder.'),
      mkItem('Ada Okafor — 55, pediatrician (Nationwide Children\'s Hospital), currently earning W-2 income.'),
      mkItem(
        'Marcus Okafor — 16, college-bound in approximately two years; 529 plan at Fidelity (current value $74,220).',
        [doc(`${D}/529 Account Summary.pdf`, 'Marcus Okafor beneficiary. Current value $74,220…', 'p. 1')],
      ),
      mkItem(
        'Zoe Okafor — 13; 529 plan at Fidelity (current value $51,880).',
        [doc(`${D}/529 Account Summary.pdf`, 'Zoe Okafor beneficiary. Current value $51,880…', 'p. 2')],
      ),
      mkItem(
        'CPA: James Thornton, Thornton Tax Partners.',
        [email(`${D}/mail/thornton.eml`, 'Looping James in on the Roth conversion bracket calc for 2025…')],
      ),
      mkItem(
        'Estate attorney: Patricia Osei, Osei & Wren Law Group; drafted the Okafor Revocable Trust in 2023.',
        [doc(`${D}/Okafor Revocable Trust.pdf`, 'Prepared by Osei & Wren Law Group. Effective date January 14, 2023…', 'p. 1')],
      ),
    ],
    money: [
      mkItem(
        'Total investable assets approximately $2.4M: Fidelity rollover IRA ($1.2M), Ada\'s hospital 403(b) ($388k), joint Schwab brokerage ($620k), and two 529 plans ($126k combined).',
        [doc(`${D}/Q1 2026 Portfolio Summary.pdf`, 'Total household investable assets $2,414,100…', 'p. 2')],
      ),
      mkItem(
        'Current allocation 70% equity / 30% fixed income; target shifts to 65/35 when Ada retires.',
        [doc(`${D}/Q1 2026 Portfolio Summary.pdf`, 'Equity 70.1%, fixed income 29.9%…', 'p. 3')],
      ),
      mkItem(
        'Roth conversion ladder active since 2025: converting approximately $80k/year from the rollover IRA to fill the 22% bracket while Ada\'s income keeps them below the 24% threshold.',
        [email(`${D}/mail/thornton.eml`, 'With Ada\'s W-2 at $290k the 22% bracket ceiling is roughly $383k — room for about $80k conversion…')],
      ),
      mkItem(
        'Marcus\'s 529 is on track for a 4-year in-state degree; Zoe\'s will need an additional ~$12k in contributions over the next two years to reach the same target.',
        [doc(`${D}/529 Projection.pdf`, 'Zoe\'s account requires approximately $12,000 in additional contributions to meet the 4-year in-state projection…', 'p. 1')],
      ),
      mkItem(
        'No concentrated single-stock positions; rollover proceeds re-invested into the agreed model portfolio in April 2025.',
        [doc(`${D}/Fidelity Rollover Confirmation.pdf`, 'Proceeds re-invested per the agreed model portfolio on April 3, 2025…', 'p. 2')],
      ),
    ],
    followups: [
      mkItem(
        'Ada\'s 2026 403(b) contribution: maximizing to $23,500 + $7,500 age-55 catch-up ($31,000 total).',
        [email(`${D}/mail/ada-403b-2026.eml`, 'Confirming the catch-up contribution election is in place for the plan year…')],
      ),
      mkItem(
        'Marcus starts college fall 2027; 529 distributions begin then. Need to confirm room-and-board eligibility at the target school.',
        [email(`${D}/mail/college-plan.eml`, 'Ohio State is the current top choice — confirm what 529 covers for on-campus housing…')],
      ),
      mkItem(
        'Chidi\'s RMDs from the rollover IRA begin at age 73 (2041); Roth conversion pace is the primary lever to reduce that future balance.',
      ),
      mkItem(
        'Annual review meeting scheduled for September 2026.',
        [email(`${D}/mail/review-invite.eml`, 'Confirming the Okafor annual review for September 15, 2026…')],
      ),
      mkItem('Increase Zoe\'s 529 contribution by $6,000/year over the next two years to close the college-funding gap.'),
      mkItem(
        'Review the 2026 Roth conversion amount with James Thornton; Ada\'s recent 4% raise may compress available bracket room.',
        [email(`${D}/mail/thornton.eml`, 'Ada\'s hospital gave a 4% raise — let\'s recalculate the bracket before the Q4 conversion…')],
      ),
      mkItem(
        'Confirm the Okafor Revocable Trust is properly titled on the Schwab brokerage account; estate attorney flagged this as the one open item.',
        [doc(`${D}/Osei Trust Review Notes.pdf`, 'Schwab joint brokerage: trust re-titling pending confirmation from advisor…', 'p. 1')],
      ),
      mkItem(
        'Explore donor-advised fund setup at Fidelity Charitable; target initial contribution of $25k from the brokerage in 2026.',
        [email(`${D}/mail/goals-2024.eml`, 'We\'d love to make our first DAF contribution before year-end…')],
      ),
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

function okaforClientMap(): ClientMap {
  const D = '/test-workspace/Okafor Household';
  return {
    matterId: 'matter_demo_okafor',
    sections: okaforSections(),
    completeness: {
      level: 'solid',
      know: [
        mkItem(
          'Chidi retired Jan 2025; $1.2M 401(k) rolled to Fidelity rollover IRA March 2025.',
          [doc(`${D}/Fidelity Rollover Confirmation.pdf`, 'IRA rollover complete. Transferred assets valued at $1,198,440…', 'p. 1')],
        ),
        mkItem(
          'Ada earns W-2 income as a pediatrician and plans to retire around 2031.',
          [email(`${D}/mail/ada-timeline.eml`, 'I\'m thinking five more years, give or take…')],
        ),
        mkItem(
          'Total investable assets approximately $2.4M across rollover IRA, 403(b), brokerage, and 529 plans.',
          [doc(`${D}/Q1 2026 Portfolio Summary.pdf`, 'Total household investable assets $2,414,100…', 'p. 2')],
        ),
        mkItem(
          'Roth conversion ladder active at approximately $80k/year; coordinated annually with CPA James Thornton.',
          [email(`${D}/mail/thornton.eml`, 'With Ada\'s W-2 at $290k the 22% bracket ceiling is roughly $383k…')],
        ),
        mkItem(
          'Revocable trust in place since Jan 2023 (Osei & Wren); Schwab brokerage re-titling is the one open estate item.',
          [doc(`${D}/Okafor Revocable Trust.pdf`, 'Prepared by Osei & Wren Law Group. Effective date January 14, 2023…', 'p. 1')],
        ),
      ],
      assuming: [],
      ask: [],
    },
    pendingUpdates: [],
    lastBuiltAt: '2026-06-20T16:00:00.000Z',
    lastSourceFingerprint: 'demo-fingerprint-okafor',
  };
}

/** Lighter clients so the list + search look real. No client map needed. */
const OTHER_CLIENTS: { id: string; name: string; client: string }[] = [
  { id: 'matter_demo_tran', name: 'Tran Family Trust review', client: 'The Tran Household' },
  { id: 'matter_demo_whitman', name: 'Whitman 401(k) rollover', client: 'The Whitmans' },
];

export function seedDemoClients(): void {
  const matterStore = useMatterStore.getState();
  // Idempotent: skip if the demo household already exists.
  if (matterStore.matters.some((m) => m.id === DEMO_MATTER_ID)) return;

  matterStore.createMatter({
    id: DEMO_MATTER_ID,
    name: 'Retirement & wealth plan',
    client: 'The Brennan Household',
    folderPaths: ['/test-workspace/Brennan Household'],
    isSample: true,
  });
  matterStore.createMatter({
    id: 'matter_demo_okafor',
    name: 'Okafor rollover & retirement',
    client: 'Chidi & Ada Okafor',
    folderPaths: ['/test-workspace/Okafor Household'],
    isSample: true,
  });
  for (const c of OTHER_CLIENTS) {
    matterStore.createMatter({ id: c.id, name: c.name, client: c.client });
  }

  useClientMapStore.getState().setMap(DEMO_MATTER_ID, brennanClientMap());
  useClientMapStore.getState().setMap('matter_demo_okafor', okaforClientMap());
}
