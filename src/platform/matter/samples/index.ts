/**
 * Sample workspace files (Q11 — Wave 1.5; Workstream B — profession wiring).
 *
 * Loaded as raw strings via Vite's `?raw` import. Each sample is a realistic
 * Markdown artifact so a first-run user can see what a finished workflow output
 * looks like without having to run one.
 *
 * Profession-specific samples are seeded as the PRIMARY file when the user
 * told us their profession during onboarding. The Weekly Review sample always
 * ships alongside it as a second file so every user sees the general
 * note-taking capability. For 'other' profession the three original generic
 * samples are used (unchanged behavior).
 *
 * Wired into the first-run flow (OnboardingV2's "Start with a sample practice"
 * path) via `writeSampleFiles`: these files are copied into the chosen workspace
 * root, then the sample matter + a seeded Client Map are created. Existing files
 * are skipped rather than overwritten, so re-running onboarding is safe.
 */

import pricingStrategy from './Sample - Pricing Strategy.md?raw';
import clientIntake from './Sample - Client Intake.md?raw';
import weeklyReview from './Sample - Weekly Review.md?raw';
import matterOverview from './Sample - Client Overview.md?raw';
import clientResearchNote from './Sample - Client Research Note.md?raw';
import engagementSummary from './Sample - Engagement Summary.md?raw';
import householdOverview from './Sample - Household Overview.md?raw';
import meetingNotes from './Sample - Meeting Notes.md?raw';
import planSummary from './Sample - Plan Summary.md?raw';
import emailThread from './Sample - Email Thread.md?raw';
import beneficiaryEstateNotes from './Sample - Beneficiary & Estate Notes.md?raw';
import accountSummary from './Sample - Account Summary.md?raw';
import { brandText } from '@/config/brandText';

export type OnboardingProfession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

export interface SampleFile {
  /** Filename as it will appear in the workspace root. */
  filename: string;
  /** Markdown body. */
  content: string;
}

function sampleFile(filename: string, content: string): SampleFile {
  return { filename, content: brandText(content) };
}

/**
 * The original three generic sample files. Used for the 'other' profession
 * and exported for tests / UI that need a stable file count.
 */
export const SAMPLE_FILES: SampleFile[] = [
  sampleFile('Sample - Client Intake.md', clientIntake),
  sampleFile('Sample - Weekly Review.md', weeklyReview),
  sampleFile('Sample - Pricing Strategy.md', pricingStrategy),
];

/**
 * Profession-specific primary samples. The first file an attorney, CPA, or
 * consultant sees when they open Lantern should look like their own work.
 */
const LEGAL_PRIMARY = sampleFile('Sample - Client Overview.md', matterOverview);

const TAX_PRIMARY = sampleFile('Sample - Client Research Note.md', clientResearchNote);

const CONSULTING_PRIMARY = sampleFile('Sample - Engagement Summary.md', engagementSummary);

const ADVISOR_OVERVIEW = sampleFile('Sample - Household Overview.md', householdOverview);

const ADVISOR_MEETING = sampleFile('Sample - Meeting Notes.md', meetingNotes);

const ADVISOR_PLAN = sampleFile('Sample - Plan Summary.md', planSummary);

const ADVISOR_EMAIL_THREAD = sampleFile('Sample - Email Thread.md', emailThread);

const ADVISOR_BENEFICIARY_ESTATE = sampleFile(
  'Sample - Beneficiary & Estate Notes.md',
  beneficiaryEstateNotes,
);

const ADVISOR_ACCOUNT_SUMMARY = sampleFile('Sample - Account Summary.md', accountSummary);

const WEEKLY_REVIEW_SAMPLE = sampleFile('Sample - Weekly Review.md', weeklyReview);

/**
 * Return the ordered list of sample files to seed for the given profession.
 *
 * - advisor: Household Overview + Account Summary + Meeting Notes + Plan Summary + Email Thread + Beneficiary & Estate Notes
 * - legal: Matter Overview (primary) + Weekly Review
 * - tax: Client Research Note (primary) + Weekly Review
 * - consulting: Engagement Summary (primary) + Weekly Review
 * - other: the original three generic samples (unchanged behavior)
 */
export function getSamplesForProfession(profession: OnboardingProfession): SampleFile[] {
  switch (profession) {
    case 'advisor':
      return [
        ADVISOR_OVERVIEW,
        ADVISOR_ACCOUNT_SUMMARY,
        ADVISOR_MEETING,
        ADVISOR_PLAN,
        ADVISOR_EMAIL_THREAD,
        ADVISOR_BENEFICIARY_ESTATE,
      ];
    case 'legal':
      return [LEGAL_PRIMARY, WEEKLY_REVIEW_SAMPLE];
    case 'tax':
      return [TAX_PRIMARY, WEEKLY_REVIEW_SAMPLE];
    case 'consulting':
      return [CONSULTING_PRIMARY, WEEKLY_REVIEW_SAMPLE];
    case 'other':
    default:
      return SAMPLE_FILES;
  }
}

/**
 * Write sample files into the supplied workspace for the given profession.
 * Skips (does NOT overwrite) any sample whose filename is already in use --
 * a safety net so a user who re-runs onboarding doesn't clobber their edited copy.
 *
 * Returns the list of files actually written (useful for tests and telemetry).
 */
export async function writeSampleFiles(
  workspace: { writeFile: (path: string, content: string) => Promise<void>; exists: (path: string) => Promise<boolean> },
  profession: OnboardingProfession = 'other',
): Promise<string[]> {
  const samples = getSamplesForProfession(profession);
  const written: string[] = [];
  for (const sample of samples) {
    let targetName = sample.filename;
    // If a file with the same name already lives in the workspace, suffix with
    // (1), (2), ... until we find an unused slot. This is a belt-and-suspenders
    // safety net; on first run the workspace is empty and the first try wins.
    let suffix = 0;
    while (await workspace.exists(targetName)) {
      suffix += 1;
      if (suffix > 20) break; // runaway guard
      const base = sample.filename.replace(/\.md$/i, '');
      targetName = `${base} (${suffix}).md`;
    }
    if (suffix > 20) continue; // give up on this sample
    await workspace.writeFile(targetName, sample.content);
    written.push(targetName);
  }
  return written;
}
