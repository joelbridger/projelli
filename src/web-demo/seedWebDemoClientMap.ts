/**
 * seedWebDemoClientMap — public-demo-only seed of the Webb Household client and
 * its fully-filled, cited Client Map.
 *
 * The web demo (keepance.com/try, advisor pack) seeds the Webb Household FILES
 * into OPFS but no client record, so its Client Map tab would render empty. This
 * module creates a demo-only matter keyed to the seeded `/keepance-demo/Webb
 * Household` folder and seeds a hand-authored "solid" Client Map for it — no AI,
 * pure data, exactly like the desktop `seedDemoClients`. Every fact cites a real
 * seeded Webb file, so the [source] chips open the actual demo documents.
 *
 * It also focuses that client and opens its hub, so the demo BOOTS straight into
 * the filled Client Map (the first screen a visitor sees) rather than the file
 * browser. The not-in-Tauri guard in MatterHub keeps the background "check for
 * updates" step from wiping this seeded map in the browser.
 *
 * Desktop never imports this module — only the web-demo entry point does, and it
 * runs only for the advisor profession (the Webb pack).
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

// The demo workspace root is `/keepance-demo`; the seeded Webb files live under
// `/keepance-demo/Webb Household/...` (root-prefixed, matching the file tree).
const WEBB_MATTER_ID = 'matter_demo_webb';
const WEBB_DIR = '/keepance-demo/Webb Household';
const SEED_TS = '2026-06-13T09:30:00.000Z';

let itemSeq = 0;
function mkItem(text: string, sources: SourceRef[] = []): ClientMapItem {
  itemSeq += 1;
  return {
    id: `webb-it-${String(itemSeq)}`,
    text,
    origin: 'ai',
    isAssumption: false,
    sources,
    updatedAt: SEED_TS,
  };
}
/** A document source ref pointing at a real seeded Webb file. */
function doc(file: string, snippet: string): SourceRef {
  return { kind: 'document', ref: `${WEBB_DIR}/${file}`, snippet };
}

const PLAN = 'Financial Plan Summary.md';
const NOTES = 'Review Notes.md';
const BENE = 'Beneficiary Designations.md';
const INTAKE = 'Client Intake Summary.md';

function webbSections(): ClientMapSection[] {
  // Re-bucketed (2026-06-29) into the researched, non-overlapping advisor
  // categories. Internal keys are unchanged; the meaning is the new TITLE:
  //   people = The household, story = What they want, standing = Money & accounts,
  //   upcoming = Coming up, next = Follow-ups.
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    // The household — who they are, their life, and the people around them.
    people: [
      mkItem('Marcus (38) and Tanya (37) Webb — married, with two young children, Caleb (8) and Ava (5).', [doc(PLAN, 'Clients: Marcus Webb (38) and Tanya Webb (37). Dependents: Caleb (8), Ava (5)')]),
      mkItem('Marcus changed employers last year — the job change is what triggered the rollover; he is the primary decision-maker.', [doc(NOTES, 'Marcus changed jobs last year. The $96k from the old employer 401(k) is still at the prior custodian.')]),
      mkItem('They switched to us after a friend’s advisor missed a beneficiary problem — trust is the reason they moved.', [doc(INTAKE, 'Came in wary after a prior advisor missed a beneficiary issue; wants someone who catches what they would miss.')]),
      mkItem('Their CPA coordinates tax timing; no estate attorney is engaged yet.', [doc(INTAKE, 'Coordinate the Roth conversion timing with their CPA before executing. No estate attorney on file.')]),
      mkItem("Jessica Reyes — Marcus's first wife (divorced 2019); still named on the old 401(k).", [doc(BENE, 'Old 401(k) (prior employer) | Marcus | Jessica Reyes (100%) … dated 2019')]),
    ],
    // What they want — goals, priorities, and risk attitude (no dates, no balances).
    story: [
      mkItem('Retire by 60.', [doc(INTAKE, 'Goal: retire by 60.')]),
      mkItem('Get both kids through college without loans.', [doc(INTAKE, 'Get both kids through college without loans.')]),
      mkItem('Pay off the house early.', [doc(PLAN, 'Goals: retire at 60, fund both kids’ college, pay off the house early')]),
      mkItem('Stop worrying every market dip — moderate-growth risk profile confirmed on the March 2026 questionnaire.', [doc(PLAN, 'Risk profile: Moderate growth (completed questionnaire, March 2026)')]),
    ],
    // Money & accounts — where the money stands today (facts; the fix-its are Follow-ups).
    standing: [
      mkItem("Marcus's 401(k): $412,000, contributing 12% with a 4% match.", [doc(PLAN, 'Marcus 401(k): $412,000, contributing 12% plus a 4% match')]),
      mkItem('Old employer 401(k): $96,000 still at the prior custodian, not yet rolled over.', [doc(PLAN, 'Old employer 401(k) of $96,000 still sitting at the prior custodian, not yet rolled over')]),
      mkItem("Tanya's 403(b): $188,000 at 9%; joint brokerage $145,000, mostly index funds.", [doc(PLAN, 'Tanya 403(b): $188,000, contributing 9%. Joint brokerage: $145,000, mostly index funds')]),
      mkItem('Roth IRAs $61,000 (Marcus) and $54,000 (Tanya); 529s $48,000 (Caleb) and $29,000 (Ava).', [doc(PLAN, 'Roth IRAs: $61,000 (Marcus), $54,000 (Tanya). 529 plans: $48,000 (Caleb), $29,000 (Ava)')]),
      mkItem('Cash reserve $55,000 (about five months); mortgage $318,000 at 5.1% with 26 years left.', [doc(PLAN, 'Cash reserve: $55,000 (about 5 months of expenses). Mortgage: $318,000 at 5.1%, 26 years left')]),
      mkItem("Stale beneficiary: the old 401(k) still names Marcus's ex-wife, not Tanya.", [doc(BENE, 'still lists Jessica Reyes, Marcus’s first wife, as the sole primary beneficiary, dated 2019')]),
    ],
    // Coming up — dated, calendar-able events (not open-ended goals, not my to-dos).
    upcoming: [
      mkItem('Year-end: decide the Roth conversion amount with the CPA.', [doc(PLAN, 'Decide on the Roth conversion amount before year-end.')]),
      mkItem('Before December: top up the 529s to capture the state tax deduction.', [doc(PLAN, 'Top up the 529 plans before December for the state tax deduction.')]),
      mkItem('Fall: the next scheduled annual review.', [doc(NOTES, 'Next review booked for the fall.')]),
      mkItem('This quarter: close out the old-401(k) rollover.', [doc(NOTES, "The old 401(k) rollover is the priority, it's been sitting too long.")]),
    ],
    // Follow-ups — the advisor's own open items and promises.
    next: [
      mkItem('Start the rollover paperwork and confirm the receiving IRA.', [doc(PLAN, 'Confirm the rollover paperwork and the receiving account.')]),
      mkItem('Send the beneficiary-change form for the old 401(k).', [doc(BENE, "If he died before the rollover, that account would pass to his ex-spouse, not to Tanya.")]),
      mkItem("Confirm every beneficiary row against the custodian's record, not the client's memory.", [doc(BENE, 'Confirm every row against the custodian, not the client\'s memory.')]),
      mkItem('Set up the $400/month brokerage auto-contribution after Tanya’s raise.', [doc(NOTES, 'Increase the joint brokerage auto-contribution by $400/month.')]),
      mkItem('Settle the Roth conversion amount before December.', [doc(NOTES, 'Revisit the Roth conversion before December.')]),
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

function webbClientMap(): ClientMap {
  return {
    matterId: WEBB_MATTER_ID,
    sections: webbSections(),
    completeness: {
      level: 'solid',
      know: [
        mkItem("The old 401(k) still names Marcus's ex-wife, Jessica Reyes, as 100% primary beneficiary — a stale 2019 form.", [doc(BENE, 'still lists Jessica Reyes, Marcus\'s first wife, as the sole primary beneficiary, dated 2019')]),
        mkItem('Rolling the $96,000 old 401(k) into a Marcus IRA is the standing priority.', [doc(NOTES, 'Roll the old 401(k) into Marcus\'s IRA. I\'ll start the paperwork.')]),
        mkItem('After Tanya\'s raise, $400/month more is going into the joint brokerage.', [doc(NOTES, 'They can push another $400/month into savings.')]),
        mkItem('About five months of expenses sit in the $55,000 cash reserve.', [doc(PLAN, 'Cash reserve: $55,000 (about 5 months of expenses)')]),
        mkItem('Headline goals: retire at 60 and fund both kids through college.', [doc(PLAN, 'Goals: Retire at 60, fund both kids\' college, pay off the house early')]),
      ],
      assuming: [],
      ask: [],
    },
    pendingUpdates: [],
    lastBuiltAt: SEED_TS,
    lastSourceFingerprint: 'demo-fingerprint-webb',
  };
}

/**
 * Seed the Webb Household client + Client Map and open its hub so the demo lands
 * on the filled map. Idempotent: if the matter already exists we only re-focus
 * it (the demo resets on reload, so re-focusing is the desired behavior).
 */
export function seedWebDemoClientMap(): void {
  const matterStore = useMatterStore.getState();
  const exists = matterStore.matters.some((m) => m.id === WEBB_MATTER_ID);
  if (!exists) {
    matterStore.createMatter({
      id: WEBB_MATTER_ID,
      name: 'Webb Household',
      client: 'Marcus & Tanya Webb',
      folderPaths: [WEBB_DIR],
    });
  }
  if (useClientMapStore.getState().getMap(WEBB_MATTER_ID) === undefined) {
    useClientMapStore.getState().setMap(WEBB_MATTER_ID, webbClientMap());
  }
  // Focus the client and open its hub so the Client Map is the first screen.
  matterStore.setActiveMatter(WEBB_MATTER_ID);
  matterStore.setClientMapHubId(WEBB_MATTER_ID);
}
