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
    story: [
      mkItem('Became clients in 2019, referred by their CPA after selling stakes in two dental practices.'),
      mkItem('Sold the remaining practice to Heartland Dental in March 2023 for $3.8M (earn-out runs through 2025).', [doc(`${D}/Sale Agreement.pdf`, 'Purchase price of $3,800,000…', 'p. 1')]),
      mkItem('Stated goal: retire fully by 2027 and seed a small family foundation.', [email(`${D}/mail/goals.eml`, 'We would love to set up a foundation for the grandkids…')]),
    ],
    people: [
      mkItem('Robert Brennan — 62, retiring dentist, primary decision-maker.'),
      mkItem('Susan Brennan — 60, spouse, former practice office manager.'),
      mkItem('Adult children: Megan (34, getting married) and Daniel (31).'),
      mkItem('CPA: Maria Alvarez, Alvarez & Co.', [email(`${D}/mail/alvarez.eml`, 'Looping in Maria on the Roth conversion…')]),
      mkItem('Estate attorney: Linda Park, Park & Wills LLP.', [doc(`${D}/Estate Plan Summary.pdf`, 'Prepared by Park & Wills LLP…', 'p. 2')]),
    ],
    standing: [
      mkItem('Investable assets $4.2M; current allocation 62% equity / 38% fixed income.', [doc(`${D}/Q1 Statement.pdf`, 'Total portfolio value $4,201,880…', 'p. 3')]),
      mkItem('Roth conversion ladder underway since 2024 to fill the 24% bracket.'),
      mkItem('Concentrated position: $480k of Heartland Dental stock from the sale.', [email(`${D}/mail/concentration.eml`, 'Still holding the Heartland shares…')]),
      mkItem('Two 529 plans for the grandchildren, about $85k combined.'),
    ],
    upcoming: [
      mkItem("Robert's required minimum distributions begin 2027."),
      mkItem("Megan's wedding, spring 2026 — gifting question still open."),
      mkItem('Annual review meeting booked for May 2026.', [email(`${D}/mail/review-invite.eml`, 'Confirming our annual review for May…')]),
    ],
    next: [
      mkItem('Rebalance back toward the 60/40 target.'),
      mkItem('Diversify the concentrated Heartland position over 2025–2026.'),
      mkItem('Confirm the 2026 gifting strategy with the CPA before year-end.'),
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
        { text: 'Has their risk tolerance changed since the practice sale?', sectionKey: 'standing' },
        { text: 'Do they want to make annual-exclusion gifts to the kids before year-end?', sectionKey: 'next' },
      ],
    },
    pendingUpdates: [],
    lastBuiltAt: '2026-06-20T16:00:00.000Z',
    lastSourceFingerprint: 'demo-fingerprint',
  };
}

/** Lighter clients so the list + search look real. No client map needed. */
const OTHER_CLIENTS: { id: string; name: string; client: string }[] = [
  { id: 'matter_demo_tran', name: 'Tran Family Trust review', client: 'The Tran Household' },
  { id: 'matter_demo_okafor', name: 'Okafor rollover & retirement', client: 'Chidi & Ada Okafor' },
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
  for (const c of OTHER_CLIENTS) {
    matterStore.createMatter({ id: c.id, name: c.name, client: c.client });
  }

  useClientMapStore.getState().setMap(DEMO_MATTER_ID, brennanClientMap());
}
