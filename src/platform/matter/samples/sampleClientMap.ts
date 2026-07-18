/**
 * sampleClientMap — hand-authored, fully-cited Client Map for the first-run
 * advisor sample (the Hendricks Household).
 *
 * The advisor sample writes six realistic `Sample - *.md` files into the
 * workspace root (see `samples/index.ts`) and creates the sample matter
 * (`getOrCreateSampleMatter`). Those give a new advisor real documents, but the
 * Client Map tab would still render empty until something builds a map — and a
 * real build needs the RAG index + an AI provider, neither of which exists in
 * the first sixty seconds of onboarding.
 *
 * So we seed a deterministic "solid" Client Map here, exactly the way the public
 * web demo seeds the Webb Household (`web-demo/seedWebDemoClientMap`): no AI, no
 * network, pure data. Every fact cites one of the real sample files by its
 * workspace-relative name, so the [source] chips open the actual `.md` the fact
 * came from. `openSourceDocument` resolves a relative ref against the workspace
 * root, so these refs are cross-platform (no embedded path separators).
 *
 * The map intentionally demonstrates synthesis across documents — e.g. it
 * reflects that the beneficiary problem flagged in the April meeting notes was
 * resolved in the May email thread, which is exactly the "answers across all of
 * it" value the product promises.
 */
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  issueMatterScopeSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  CoreSectionKey,
  SourceRef,
} from '@/platform/clientMap/types';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';

// Deterministic timestamp so the seed is stable across runs (no Date.now()).
const SEED_TS = '2026-06-30T09:30:00.000Z';

// Workspace-relative sample file names (written at the workspace root by
// writeSampleFiles for the 'advisor' profession). openSourceDocument joins a
// relative ref onto the active workspace root, so these stay cross-platform.
const HH = 'Sample - Household Overview.md';
const ACCT = 'Sample - Account Summary.md';
const MTG = 'Sample - Meeting Notes.md';
const PLAN = 'Sample - Plan Summary.md';
const EMAIL = 'Sample - Email Thread.md';
const BENE = 'Sample - Beneficiary & Estate Notes.md';

let itemSeq = 0;
function mkItem(text: string, sources: SourceRef[] = []): ClientMapItem {
  itemSeq += 1;
  return {
    id: `hendricks-it-${String(itemSeq)}`,
    text,
    origin: 'ai',
    isAssumption: false,
    sources,
    updatedAt: SEED_TS,
  };
}

/** A document source ref. `snippet` is a real substring of the file so the
 *  scroll-to-snippet lands on the cited passage. */
function doc(file: string, snippet: string): SourceRef {
  return { kind: 'document', ref: file, snippet };
}

function hendricksSections(): ClientMapSection[] {
  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    // Household — who they are and the people around them.
    household: [
      mkItem(
        'Robert (64, retired civil engineer) and Susan (62, high school principal retiring in two years) Hendricks — a married couple nearing retirement.',
        [doc(HH, 'Robert Hendricks (64) is a retired civil engineer. Susan Hendricks (62) is a high school principal planning to retire in two years.')],
      ),
      mkItem(
        'All accounts are custodied at Charles Schwab; their plan lives in RightCapital, tax projections in Holistiplan, risk profiling in DataPoints.',
        [doc(ACCT, 'Custodian: Charles Schwab (all accounts)'), doc(HH, 'Their financial plan lives in RightCapital; tax projections run through Holistiplan; risk profiling through DataPoints.')],
      ),
      mkItem(
        'They own their home outright (about $740K) and carry no debt.',
        [doc(HH, 'They own their home outright (estimated value $740K) and carry no debt.')],
      ),
      mkItem(
        'Daughter Emily marries June 15, 2024; three grandchildren (ages 2, 4, and 7) are the intended equal contingent beneficiaries.',
        [doc(BENE, 'Daughter:** Emily Hendricks (getting married June 15, 2024)'), doc(BENE, 'Three grandchildren** (ages 2, 4, and 7 as of 2024), intended equal contingent beneficiaries')],
      ),
    ],
    // Goals — what they want; no balances or dated tasks here.
    goals: [
      mkItem(
        'Retire on full portfolio + Social Security income — Robert already semi-retired, Susan retiring at 64 (2026).',
        [doc(HH, 'Retire at 66 (Robert) and 64 (Susan).')],
      ),
      mkItem(
        "Seed each of three grandchildren's 529 plans with about $30,000 over the next few years.",
        [doc(HH, "Fund grandchildren's 529 plans."), doc(EMAIL, 'we want to seed each account with roughly $30,000 over the next few years')],
      ),
      mkItem(
        'Leave a legacy: ~$250,000 earmarked for a charitable remainder trust funding a scholarship at Susan\'s alma mater.',
        [doc(HH, 'They have earmarked $250,000 for a charitable remainder trust to fund a scholarship')],
      ),
      mkItem(
        'Maintain their current ~$9,200/month lifestyle in early retirement; moderate risk tolerance (DataPoints score 58/100).',
        [doc(HH, 'Monthly spending is approximately $9,200.'), doc(HH, 'Risk tolerance score:** 58 out of 100 (moderate)')],
      ),
    ],
    // Money and accounts — where things stand today.
    money: [
      mkItem(
        "Robert's rollover IRA is ~$1.4M (the primary pre-tax account; RMDs begin at 73 in 2033).",
        [doc(ACCT, 'Rollover IRA | Robert | Traditional IRA | $1,400,000 | Primary pre-tax account; subject to RMDs at 73 (2033)')],
      ),
      mkItem(
        'Other accounts: joint taxable brokerage ~$380K, Robert consulting 401(k) ~$62K, Susan 403(b) ~$520K — total household portfolio ~$2.36M.',
        [doc(ACCT, 'Total approximate household portfolio:** $2,362,000 (pre-conversion)')],
      ),
      mkItem(
        "Susan's pension pays ~$3,210/month at age 64 (full benefit); both delay Social Security to maximize it.",
        [doc(ACCT, 'Pension | Susan | 2026 (age 64) | $3,210 | Defined benefit, fixed'), doc(PLAN, "Robert's Social Security | Age 70 (2030) | $3,840 | Delayed for maximum benefit")],
      ),
      mkItem(
        'Allocation has drifted to ~68/30/2 against the 65/35/5 target (equity growth in 2023); a rebalance is planned.',
        [doc(ACCT, 'the portfolio has drifted from the 65/35/5 target to approximately 68/30/2 due to equity market performance in 2023')],
      ),
      mkItem(
        'Plan health is strong: 94% Monte Carlo success, 81% under a severe early-retirement stress scenario.',
        [doc(PLAN, 'Current plan probability:** 94% (1,000 simulations)'), doc(PLAN, 'Stress scenario (60% market drop in year 2):** 81%')],
      ),
    ],
    // Follow-ups — open items, promises, and dated next steps.
    followups: [
      mkItem(
        'Execute the partial Roth conversion in Q4 — ~$48,000 to the top of the 24% bracket, refined with Holistiplan in October.',
        [doc(MTG, 'The target conversion amount is approximately $48,000, which takes them to the top of the 24% bracket'), doc(EMAIL, 'We are targeting Q4, most likely November or December')],
      ),
      mkItem(
        'Pay the ~$11,500 conversion tax separately from non-retirement funds (do NOT withhold from the conversion) via a Q4 estimated payment.',
        [doc(EMAIL, 'do NOT withhold from the converted amount itself')],
      ),
      mkItem(
        'Rebalance the portfolio back to 65/35/5 within 60 days of the April meeting.',
        [doc(MTG, 'Rebalance portfolio to 65/35 within 60 days')],
      ),
      mkItem(
        "Confirm the consulting 401(k) beneficiary (still 'to be confirmed') and open Susan's Roth IRA after the Q4 conversion.",
        [doc(BENE, 'Consulting 401(k) (Robert) | 401(k) | Susan Hendricks | To be confirmed | Review needed')],
      ),
      mkItem(
        'Schedule the long-term-care insurance review before Susan\'s group coverage lapses at retirement (LTC specialist call set for May).',
        [doc(MTG, "Susan's group coverage through the school district ends when she retires. We flagged this as a 2025 priority.")],
      ),
      mkItem(
        'Finalize the charitable remainder trust with the estate attorney (referral sent) and revisit 529 funding at the October review.',
        [doc(MTG, 'I confirmed we have a referral out to an estate attorney who specializes in CRTs.')],
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

function hendricksClientMap(matterId: string): ClientMap {
  return {
    matterId,
    sections: hendricksSections(),
    completeness: {
      level: 'solid',
      know: [
        mkItem(
          'The beneficiary problem flagged in April (Robert\'s IRA still named his late mother, Margaret) was RESOLVED on May 29 — Susan is now primary; the grandchildren are equal contingents.',
          [doc(MTG, 'still list his mother as primary beneficiary. She passed in September 2022.'), doc(BENE, 'updated both the rollover IRA and the taxable brokerage at Schwab on May 29, 2024')],
        ),
        mkItem(
          'A $48,000 Q4 Roth conversion to the top of the 24% bracket is decided; IRMAA exposure was checked and stays below the $206,000 surcharge threshold for 2024.',
          [doc(EMAIL, 'a $48,000 conversion keeps you well below that level, so we do not expect any IRMAA exposure this year')],
        ),
        mkItem(
          'Headline goals: retire by 2026, fund three grandchildren\'s 529s, and put a charitable remainder trust in place before Susan retires.',
          [doc(HH, 'Leave a legacy.')],
        ),
      ],
      assuming: [],
      ask: [],
    },
    pendingUpdates: [],
    lastBuiltAt: SEED_TS,
    lastSourceFingerprint: 'sample-fingerprint-hendricks',
  };
}

/**
 * Seed the hand-authored Hendricks Client Map for the sample matter and open its
 * hub so first-run lands on the filled map. Caller is responsible for having
 * created the sample matter (`getOrCreateSampleMatter`) and written the sample
 * files first. Idempotent: re-seeding overwrites the deterministic map.
 */
export async function seedSampleClientMap(matterId: string): Promise<void> {
  const matterStore = useMatterStore.getState();
  useClientMapStore.getState().setMap(matterId, hendricksClientMap(matterId));
  const result = await requestMatterScopeSelection(issueMatterScopeSelection(matterId));
  if (result.kind === 'refused') return;
  matterStore.setClientMapHubId(matterId);
}

// Exported for tests.
export { hendricksClientMap };
