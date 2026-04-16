/**
 * Sample workspace files (Q11 — Wave 1.5).
 *
 * Loaded as raw strings via Vite's `?raw` import. Each sample is a realistic,
 * founder-voiced Markdown artifact built for a fictional product ("Acme Budget",
 * a personal finance app for freelancers) so a first-run user can see what a
 * finished workflow output looks like without having to run one.
 *
 * Wired into FirstRunWizard. When the "Populate workspace with samples" toggle
 * is ON (default), these files are copied into the selected workspace root at
 * the end of the wizard. The wizard skips files that already exist rather than
 * overwrite, so re-running the wizard is safe.
 */

import pricingStrategy from './Sample - Pricing Strategy.md?raw';
import pitchDeck from './Sample - Pitch Deck.md?raw';
import weeklyReview from './Sample - Weekly Review.md?raw';

export interface SampleFile {
  /** Filename as it will appear in the workspace root. */
  filename: string;
  /** Markdown body. */
  content: string;
}

export const SAMPLE_FILES: SampleFile[] = [
  { filename: 'Sample - Pricing Strategy.md', content: pricingStrategy },
  { filename: 'Sample - Pitch Deck.md', content: pitchDeck },
  { filename: 'Sample - Weekly Review.md', content: weeklyReview },
];

/**
 * Write every sample file into the supplied workspace. Skips (does NOT
 * overwrite) any sample whose filename is already in use — a safety net so a
 * user who re-runs onboarding doesn't clobber their edited copy.
 *
 * Returns the list of files actually written (useful for tests and telemetry).
 */
export async function writeSampleFiles(
  workspace: { writeFile: (path: string, content: string) => Promise<void>; exists: (path: string) => Promise<boolean> }
): Promise<string[]> {
  const written: string[] = [];
  for (const sample of SAMPLE_FILES) {
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
