/**
 * Sample-matter demo data for the first-run aha moment.
 *
 * Exports three canned Q&A pairs built exclusively from the real content of
 * the legal sample files written by `writeSampleFiles`. Each answer uses
 * {n} inline citation chips and a parallel citations array whose shape
 * matches `AnswerCitation` in `ReimaginedAsk.tsx` exactly.
 *
 * NOTE: citations carry a `path` placeholder token `{WORKSPACE_ROOT}` that
 * the caller must replace with the real workspace root at display time using
 * `resolveDemoAnswerPaths(answer, workspaceRoot)`. This keeps the module
 * free of runtime Tauri/FS imports while the onboarding orchestrator wires
 * the real root in.
 *
 * No UI wiring lives here. This is data only.
 */

export { SAMPLE_MATTER_ID } from '@/stores/matterStore';
export const SAMPLE_MATTER_NAME = 'Garcia v. Meridian Properties LLC';

// ─────────────────────────────────────────────────────────────────────────────
// AnswerCitation shape (mirrored from ReimaginedAsk.tsx — keep in sync)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One cited source chip that appears in an ask answer.
 * Must match the `AnswerCitation` interface in `ReimaginedAsk.tsx` exactly.
 */
export interface AnswerCitation {
  /** 1-based chip number as it appears in the answer text as {n}. */
  n: number;
  /** Human-readable label (file basename). */
  label: string;
  /** Raw passage text from the source. */
  excerpt: string;
  /**
   * Full workspace-absolute path; null if resolution failed.
   * In demo answers use `{WORKSPACE_ROOT}` as a placeholder; call
   * `resolveDemoAnswerPaths` to substitute the real root before display.
   */
  path: string | null;
  /** Locator string identifying the section within the file. */
  locator: string;
  /** Whether the source was returned from the verified RAG store. */
  verified: boolean;
}

/** A single demo Q&A turn ready for the renderer. */
export interface DemoAnswer {
  /** Answer prose with {n} inline citation chips. */
  answer: string;
  /** Parallel citations array sorted by n ascending. */
  citations: AnswerCitation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// File path constants
// The sample files `writeSampleFiles` writes for the 'legal' profession.
// Paths are workspace-relative filenames; prepend workspaceRoot at runtime.
// ─────────────────────────────────────────────────────────────────────────────

/** Filename written to the workspace root for the primary legal sample. */
export const SAMPLE_FILE_MATTER_OVERVIEW = 'Sample - Matter Overview.md';

/** Filename written to the workspace root for the secondary legal sample. */
export const SAMPLE_FILE_WEEKLY_REVIEW = 'Sample - Weekly Review.md';

/**
 * Build the full workspace-absolute path for a sample file.
 * Centralised here so callers never have to do string concatenation themselves.
 */
export function sampleFilePath(workspaceRoot: string, filename: string): string {
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  return `${root}/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo questions
// ─────────────────────────────────────────────────────────────────────────────

/** Three natural litigator questions about the Garcia matter. */
export const DEMO_QUESTIONS: [string, string, string] = [
  'What are the open issues in this matter?',
  'Summarize the Garcia matter for me.',
  'What is the fee arrangement?',
];

// ─────────────────────────────────────────────────────────────────────────────
// Demo answers
// Paths use the {WORKSPACE_ROOT} placeholder. Call resolveDemoAnswerPaths()
// before handing to the renderer.
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_ROOT = '{WORKSPACE_ROOT}';
const MATTER_OVERVIEW_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_MATTER_OVERVIEW}`;
const WEEKLY_REVIEW_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_WEEKLY_REVIEW}`;
const MATTER_OVERVIEW_LABEL = SAMPLE_FILE_MATTER_OVERVIEW;

const DEMO_ANSWERS_MAP: Record<string, DemoAnswer> = {
  'What are the open issues in this matter?': {
    answer:
      'I found six open issues in the Garcia matter. {1} The checklist covers: pulling a copy of the lease and all amendments (Roberto is sending it by end of week); confirming Meridian\'s registered agent and entity status with the Secretary of State; determining which habitability or repair statute applies to commercial leases in this jurisdiction; assessing whether the 11-day HVAC outage constitutes constructive partial eviction; calculating damages including lost sales, the $1,140 Roberto spent on portable heating units, and any demonstrable customer attrition; and evaluating whether Roberto should continue paying full rent, withhold a portion, or exercise repair-and-deduct. {1}',
    citations: [
      {
        n: 1,
        label: MATTER_OVERVIEW_LABEL,
        excerpt:
          '- [ ] Pull a copy of the lease and all amendments (Roberto sending by end of week)\n' +
          '- [ ] Confirm Meridian\'s registered agent and entity status with the state Secretary of State\n' +
          '- [ ] Determine which state habitability/repair statute applies to commercial leases in this jurisdiction\n' +
          '- [ ] Assess whether the 11-day outage constitutes constructive partial eviction under applicable case law\n' +
          '- [ ] Calculate damages: lost sales, cost of portable heating units Roberto rented ($1,140), and any demonstrable customer attrition\n' +
          '- [ ] Evaluate whether Roberto should continue paying full rent, withhold a portion, or exercise repair-and-deduct',
        path: MATTER_OVERVIEW_PATH,
        locator: 'Sample - Matter Overview.md §Open Issues',
        verified: true,
      },
    ],
  },

  'Summarize the Garcia matter for me.': {
    answer:
      'Garcia v. Meridian Properties LLC (matter 2026-047) is a commercial lease dispute opened April 3, 2026. {1} Roberto Garcia has operated a furniture showroom at 1820 Westlake Commerce Drive, Suite 104, for six years under a triple-net lease at $4,200/month running through August 31, 2028. Beginning in December 2025, the building\'s HVAC system began failing intermittently. Meridian sent a repair crew in January and replaced a fan motor, but the problem recurred in February. As of the matter opening date, the system had been inoperable for 11 consecutive days. {1} Roberto documented every incident: he has temperature logs, three certified mail letters to Meridian\'s property manager, and two email threads with their maintenance coordinator. Meridian has not responded to the last two certified letters. {2} The main unresolved theory is whether the 11-day outage constitutes constructive partial eviction under applicable case law. Damages in play include lost sales, $1,140 in portable heating unit rentals, and customer attrition.',
    citations: [
      {
        n: 1,
        label: MATTER_OVERVIEW_LABEL,
        excerpt:
          'Roberto Garcia has operated a furniture showroom out of 1820 Westlake Commerce Drive, Suite 104, for six years. The lease is a standard triple-net with Meridian Properties LLC as landlord. Monthly base rent is $4,200. The lease runs through August 31, 2028.\n\n' +
          'Starting in December 2025, the building\'s HVAC system began failing intermittently. The showroom runs hot in winter because the heating zones for Suite 104 are fed from a shared unit that also serves Suites 101 to 103. Meridian sent a repair crew in January, replaced a fan motor, and the problem recurred in February. As of the matter opening date, the system has been inoperable for 11 consecutive days.',
        path: MATTER_OVERVIEW_PATH,
        locator: 'Sample - Matter Overview.md §Client',
        verified: true,
      },
      {
        n: 2,
        label: MATTER_OVERVIEW_LABEL,
        excerpt:
          'Roberto documented every incident. He has temperature logs pulled from a smart thermostat, three letters he sent to Meridian\'s property manager via certified mail, and two email threads with their maintenance coordinator. Meridian has not responded to either of the last two certified letters.',
        path: MATTER_OVERVIEW_PATH,
        locator: 'Sample - Matter Overview.md §Client (paragraph 2)',
        verified: true,
      },
    ],
  },

  'What is the fee arrangement?': {
    answer:
      'The fee arrangement is hourly at $350 per hour with a $3,000 retainer. {1} Roberto deposited the retainer and signed the engagement letter on April 3, 2026, the same day the matter was opened.',
    citations: [
      {
        n: 1,
        label: MATTER_OVERVIEW_LABEL,
        excerpt:
          'Fee arrangement: hourly at $350/hr with a $3,000 retainer deposited. Engagement letter signed April 3.',
        path: MATTER_OVERVIEW_PATH,
        locator: 'Sample - Matter Overview.md §Client Notes',
        verified: true,
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the demo answer for a question string.
 * Matching is case-insensitive and trims leading/trailing whitespace.
 * Returns `null` if the question does not match any of the three demo questions.
 */
export function getDemoAnswer(question: string): DemoAnswer | null {
  const normalised = question.trim().toLowerCase();
  for (const [key, answer] of Object.entries(DEMO_ANSWERS_MAP)) {
    if (key.toLowerCase() === normalised) {
      return answer;
    }
  }
  return null;
}

/**
 * Replace the `{WORKSPACE_ROOT}` placeholder in every citation `path`
 * with the real workspace root. Returns a new `DemoAnswer` with no mutation
 * of the original.
 *
 * Call this immediately before handing the answer to the renderer so the
 * "Open in editor" button resolves to the real file on disk.
 */
export function resolveDemoAnswerPaths(answer: DemoAnswer, workspaceRoot: string): DemoAnswer {
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  return {
    ...answer,
    citations: answer.citations.map((c) => ({
      ...c,
      path:
        c.path !== null
          ? c.path.replace(PLACEHOLDER_ROOT, root)
          : null,
    })),
  };
}

/**
 * Convenience: get and resolve in one call. Returns `null` if the question
 * has no matching demo answer.
 */
export function getDemoAnswerForWorkspace(
  question: string,
  workspaceRoot: string,
): DemoAnswer | null {
  const raw = getDemoAnswer(question);
  if (!raw) return null;
  return resolveDemoAnswerPaths(raw, workspaceRoot);
}

// Re-export path helpers so callers can build citation paths without
// duplicating the separator logic.
export { sampleFilePath as buildSampleFilePath };
export const DEMO_SAMPLE_FILES = [SAMPLE_FILE_MATTER_OVERVIEW, SAMPLE_FILE_WEEKLY_REVIEW] as const;

// Also re-export the weekly review path builder for future answers that cite it.
// (The weekly review is in scope but none of the three demo questions touch it
// directly -- it is available for Wave D UI wiring if a fourth question is added.)
export { WEEKLY_REVIEW_PATH as DEMO_WEEKLY_REVIEW_PLACEHOLDER_PATH };
