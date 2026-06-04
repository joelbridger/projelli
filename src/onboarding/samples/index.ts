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
 * Wired into FirstRunWizard. When the "Populate workspace with samples" toggle
 * is ON (default), these files are copied into the selected workspace root at
 * the end of the wizard. The wizard skips files that already exist rather than
 * overwrite, so re-running the wizard is safe.
 */

import pricingStrategy from './Sample - Pricing Strategy.md?raw';
import clientIntake from './Sample - Client Intake.md?raw';
import weeklyReview from './Sample - Weekly Review.md?raw';
import matterOverview from './Sample - Matter Overview.md?raw';
import clientResearchNote from './Sample - Client Research Note.md?raw';
import engagementSummary from './Sample - Engagement Summary.md?raw';

export type OnboardingProfession = 'legal' | 'tax' | 'consulting' | 'other';

export interface SampleFile {
  /** Filename as it will appear in the workspace root. */
  filename: string;
  /** Markdown body. */
  content: string;
}

/**
 * The original three generic sample files. Used for the 'other' profession
 * and exported for tests / UI that need a stable file count.
 */
export const SAMPLE_FILES: SampleFile[] = [
  { filename: 'Sample - Client Intake.md', content: clientIntake },
  { filename: 'Sample - Weekly Review.md', content: weeklyReview },
  { filename: 'Sample - Pricing Strategy.md', content: pricingStrategy },
];

/**
 * Profession-specific primary samples. The first file an attorney, CPA, or
 * consultant sees when they open Keepance should look like their own work.
 */
const LEGAL_PRIMARY: SampleFile = {
  filename: 'Sample - Matter Overview.md',
  content: matterOverview,
};

const TAX_PRIMARY: SampleFile = {
  filename: 'Sample - Client Research Note.md',
  content: clientResearchNote,
};

const CONSULTING_PRIMARY: SampleFile = {
  filename: 'Sample - Engagement Summary.md',
  content: engagementSummary,
};

const WEEKLY_REVIEW_SAMPLE: SampleFile = {
  filename: 'Sample - Weekly Review.md',
  content: weeklyReview,
};

/**
 * Return the ordered list of sample files to seed for the given profession.
 *
 * - legal: Matter Overview (primary) + Weekly Review
 * - tax: Client Research Note (primary) + Weekly Review
 * - consulting: Engagement Summary (primary) + Weekly Review
 * - other: the original three generic samples (unchanged behavior)
 */
export function getSamplesForProfession(profession: OnboardingProfession): SampleFile[] {
  switch (profession) {
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
