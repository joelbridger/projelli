/**
 * Sample-matter demo data for the first-run aha moment.
 *
 * Each profession gets its own matter name, demo questions, and canned Q&A
 * pairs built exclusively from the real content of that profession's primary
 * sample file (written by `writeSampleFiles`). Each answer uses {n} inline
 * citation chips and a parallel citations array whose shape matches
 * `AnswerCitation` in `Ask.tsx` exactly.
 *
 * NOTE: citations carry a `path` placeholder token `{WORKSPACE_ROOT}` that
 * the caller must replace with the real workspace root at display time using
 * `resolveDemoAnswerPaths(answer, workspaceRoot)`. This keeps the module
 * free of runtime Tauri/FS imports while the onboarding orchestrator wires
 * the real root in.
 *
 * No UI wiring lives here. This is data only.
 */

import { getProfession } from '@/platform/profile/professionStore';
import type { Profession } from '@/platform/profile/professionModel';

// ─────────────────────────────────────────────────────────────────────────────
// AnswerCitation shape (mirrored from Ask.tsx — keep in sync)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One cited source chip that appears in an ask answer.
 * Must match the `AnswerCitation` interface in `Ask.tsx` exactly.
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
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_ROOT = '{WORKSPACE_ROOT}';

/** Filename written to the workspace root for the primary legal sample. */
export const SAMPLE_FILE_MATTER_OVERVIEW = 'Sample - Matter Overview.md';
/** Filename written to the workspace root for the secondary sample (all professions). */
export const SAMPLE_FILE_WEEKLY_REVIEW = 'Sample - Weekly Review.md';
/** Filename written to the workspace root for the primary tax sample. */
export const SAMPLE_FILE_CLIENT_RESEARCH_NOTE = 'Sample - Client Research Note.md';
/** Filename written to the workspace root for the primary consulting sample. */
export const SAMPLE_FILE_ENGAGEMENT_SUMMARY = 'Sample - Engagement Summary.md';
/** Filename written to the workspace root for the advisor household overview sample. */
export const SAMPLE_FILE_HOUSEHOLD_OVERVIEW = 'Sample - Household Overview.md';
/** Filename written to the workspace root for the advisor meeting notes sample. */
export const SAMPLE_FILE_MEETING_NOTES = 'Sample - Meeting Notes.md';
/** Filename written to the workspace root for the advisor plan summary sample. */
export const SAMPLE_FILE_PLAN_SUMMARY = 'Sample - Plan Summary.md';
/** Filename written to the workspace root for the advisor email thread sample. */
export const SAMPLE_FILE_EMAIL_THREAD = 'Sample - Email Thread.md';
/** Filename written to the workspace root for the advisor beneficiary and estate notes sample. */
export const SAMPLE_FILE_BENEFICIARY_ESTATE = 'Sample - Beneficiary & Estate Notes.md';
/** Filename written to the workspace root for the advisor account summary sample. */
export const SAMPLE_FILE_ACCOUNT_SUMMARY = 'Sample - Account Summary.md';

/**
 * Build the full workspace-absolute path for a sample file.
 * Centralised here so callers never have to do string concatenation themselves.
 */
export function sampleFilePath(workspaceRoot: string, filename: string): string {
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  return `${root}/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-profession matter names
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_MATTER_NAMES: Record<Profession, string> = {
  legal: 'Garcia v. Meridian Properties LLC',
  tax: 'Dwyer - 2025 Form 1040',
  consulting: 'Northwind - Go-to-Market Engagement',
  advisor: 'The Hendricks Household',
  other: 'Sample Matter',
};

/**
 * Return the sample matter display name for a given profession.
 * Falls back to the legal name for unknown values.
 */
export function getSampleMatterName(profession: Profession): string {
  return SAMPLE_MATTER_NAMES[profession];
}

// Keep the original constant for backward compatibility.
export const SAMPLE_MATTER_NAME = SAMPLE_MATTER_NAMES.legal;

// ─────────────────────────────────────────────────────────────────────────────
// Demo questions per profession
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_QUESTIONS_BY_PROFESSION: Record<Profession, [string, string, string, string]> = {
  legal: [
    'What are the open issues in this matter?',
    'Summarize the Garcia matter for me.',
    'What is the status of the Meridian correspondence?',
    'What is the fee arrangement?',
  ],
  tax: [
    'Can Diane deduct her home office?',
    'What open questions remain for the Dwyer return?',
    'Which deduction method should we use?',
    'What is the exclusive-use test?',
  ],
  consulting: [
    'What are the key findings so far?',
    'What is the engagement scope?',
    'What are the next steps for Hartwell?',
    'Why does the Springfield facility have a longer fulfillment lag?',
  ],
  advisor: [
    'What did we decide about the Roth conversion?',
    "What are the Hendricks' top goals?",
    'What is their risk tolerance?',
    'What is coming up for this household?',
  ],
  other: [
    'What are the open issues in this matter?',
    'Summarize this matter for me.',
    'What is the fee arrangement?',
    'What documents are outstanding?',
  ],
};

/**
 * Return the four demo questions for a given profession.
 * Defaults to legal questions when the profession is unrecognised.
 */
export function getDemoQuestions(profession: Profession): [string, string, string, string] {
  return DEMO_QUESTIONS_BY_PROFESSION[profession];
}

/**
 * The original DEMO_QUESTIONS export (legal) kept for backward compatibility
 * with callers that have not yet been updated to use getDemoQuestions().
 */
export const DEMO_QUESTIONS: [string, string, string, string] = DEMO_QUESTIONS_BY_PROFESSION.legal;

// ─────────────────────────────────────────────────────────────────────────────
// Demo answers
// Paths use the {WORKSPACE_ROOT} placeholder. Call resolveDemoAnswerPaths()
// before handing to the renderer.
// ─────────────────────────────────────────────────────────────────────────────

// ── Legal demo answers ──────────────────────────────────────────────────────

const MATTER_OVERVIEW_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_MATTER_OVERVIEW}`;
const WEEKLY_REVIEW_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_WEEKLY_REVIEW}`;
const MATTER_OVERVIEW_LABEL = SAMPLE_FILE_MATTER_OVERVIEW;

const LEGAL_DEMO_ANSWERS_MAP: Record<string, DemoAnswer> = {
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

  'What is the status of the Meridian correspondence?': {
    answer:
      'The correspondence backlog with Meridian is now cleared. {1} Three certified mail responses were drafted and sent during the week of May 19 to May 25, 2026. {1} Prior to that, Roberto had already documented the dispute with three certified letters and two email threads to Meridian\'s maintenance coordinator, though Meridian had not responded to the last two certified letters as of the matter opening date. {2}',
    citations: [
      {
        n: 1,
        label: SAMPLE_FILE_WEEKLY_REVIEW,
        excerpt:
          'Cleared the Meridian correspondence backlog (three certified mail responses drafted and sent)',
        path: WEEKLY_REVIEW_PATH,
        locator: 'Sample - Weekly Review.md §Tasks completed',
        verified: true,
      },
      {
        n: 2,
        label: MATTER_OVERVIEW_LABEL,
        excerpt:
          'Roberto documented every incident. He has temperature logs pulled from a smart thermostat, three letters he sent to Meridian\'s property manager via certified mail, and two email threads with their maintenance coordinator. Meridian has not responded to either of the last two certified letters.',
        path: MATTER_OVERVIEW_PATH,
        locator: 'Sample - Matter Overview.md §Client',
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

// ── Tax demo answers ────────────────────────────────────────────────────────
// Source: Sample - Client Research Note.md (Diane Yuen, 2025 Form 1040)

const CLIENT_RESEARCH_NOTE_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_CLIENT_RESEARCH_NOTE}`;
const CLIENT_RESEARCH_NOTE_LABEL = SAMPLE_FILE_CLIENT_RESEARCH_NOTE;

const TAX_DEMO_ANSWERS_MAP: Record<string, DemoAnswer> = {
  'Can Diane deduct her home office?': {
    answer:
      'Yes, the studio room almost certainly qualifies for a home-office deduction. {1} Under IRC Section 280A(c)(1), a portion of a dwelling is deductible when it is used exclusively and regularly as the principal place of business. Diane\'s dedicated 280-square-foot studio, used solely for client meetings and design work, appears to satisfy both tests -- but she needs to confirm no personal use ever occurs there. {1} The living-room desk, by contrast, almost certainly fails the exclusive-use test and should not be included in the deduction. {2}',
    citations: [
      {
        n: 1,
        label: CLIENT_RESEARCH_NOTE_LABEL,
        excerpt:
          'IRC Section 280A(a) disallows deductions for expenses attributable to the use of a dwelling unit as a residence. Section 280A(c)(1) creates an exception when a portion of the home is used exclusively and regularly as the principal place of business for any trade or business of the taxpayer.\n\nThe studio room. Based on what Diane described, the studio appears to satisfy both tests. "Exclusive" use is the harder standard. If she never uses that room for personal activities, the exclusivity test is met. She needs to confirm this -- even occasional personal use (a guest sleeping there, a TV for personal viewing) can break it.',
        path: CLIENT_RESEARCH_NOTE_PATH,
        locator: 'Sample - Client Research Note.md §Preliminary Analysis',
        verified: true,
      },
      {
        n: 2,
        label: CLIENT_RESEARCH_NOTE_LABEL,
        excerpt:
          'The living-room desk. The living-room desk almost certainly fails the exclusive-use test. Deducting that space would be difficult to defend.',
        path: CLIENT_RESEARCH_NOTE_PATH,
        locator: 'Sample - Client Research Note.md §Preliminary Analysis (living room)',
        verified: true,
      },
    ],
  },

  'What open questions remain for the Dwyer return?': {
    answer:
      'There are four open items before I can finalize the home-office position. {1} First, Diane needs to confirm the studio is used exclusively for business -- no personal use, no guests, no dual purpose. Second, I need the square footage confirmed against a floor plan or appraisal record. Third, if we go with the actual-expense method, I need the 2025 Form 1098, utility bills, homeowner\'s insurance, and any repair receipts. Fourth, I should ask whether she has any employees who work in the home, which would affect the deduction calculation. {1}',
    citations: [
      {
        n: 1,
        label: CLIENT_RESEARCH_NOTE_LABEL,
        excerpt:
          '- [ ] Confirm the studio is used exclusively for business (no personal use, no guests, no dual purpose)\n' +
          '- [ ] Get square footage confirmed against floor plan or lease / appraisal records\n' +
          '- [ ] Pull 2025 mortgage interest statement (Form 1098), utilities, homeowner\'s insurance, and any repair receipts if going with actual-expense method\n' +
          '- [ ] Ask whether she has any employees who work in the home (rare for a solo designer, but worth asking)',
        path: CLIENT_RESEARCH_NOTE_PATH,
        locator: 'Sample - Client Research Note.md §Open Questions',
        verified: true,
      },
    ],
  },

  'Which deduction method should we use?': {
    answer:
      'Diane has two options. {1} The simplified method (Rev. Proc. 2013-13) gives her $5 per square foot up to 300 square feet -- at 280 square feet that is a $1,400 deduction with minimal record-keeping. The actual-expense method computes 280/1400 = 20% of her mortgage interest, utilities, insurance, and repairs, which may produce a larger deduction but requires receipts and mortgage documentation. I recommend getting the actual-expense numbers first to see whether the extra paperwork pays off; if the difference is small, the simplified method saves time and reduces audit risk. {1}',
    citations: [
      {
        n: 1,
        label: CLIENT_RESEARCH_NOTE_LABEL,
        excerpt:
          'Calculation method. Diane can choose between the actual-expense method and the simplified method (Rev. Proc. 2013-13, $5/sq ft, max 300 sq ft). Her studio is 280 sq ft, so the simplified method would give her a $1,400 deduction with minimal record-keeping. The actual-expense method (280/1400 = 20% of mortgage interest, utilities, insurance, repairs) may produce a larger deduction but requires receipts and mortgage documentation.',
        path: CLIENT_RESEARCH_NOTE_PATH,
        locator: 'Sample - Client Research Note.md §Preliminary Analysis (calculation method)',
        verified: true,
      },
    ],
  },

  'What is the exclusive-use test?': {
    answer:
      'The exclusive-use test is the hardest element of the home-office deduction to satisfy. {1} Under IRC 280A, the portion of the home must be used ONLY for business -- even occasional personal use (a guest sleeping in the room, a TV for personal viewing, or any dual-purpose activity) breaks the test entirely. This is the element the IRS focuses on almost exclusively in audits. {1} Diane needs to confirm she never uses the studio for anything personal before I can finalize the position.',
    citations: [
      {
        n: 1,
        label: CLIENT_RESEARCH_NOTE_LABEL,
        excerpt:
          '"Exclusive" use is the harder standard. If she never uses that room for personal activities, the exclusivity test is met. She needs to confirm this -- even occasional personal use (a guest sleeping there, a TV for personal viewing) can break it.\n\nThis note reflects a preliminary read of the facts as Diane described them. Do not finalize the deduction position until you have reviewed the actual space and confirmed exclusive use with Diane directly. If exclusivity is in doubt, document your determination and keep it in the file. IRC 280A audits focus almost entirely on this element.',
        path: CLIENT_RESEARCH_NOTE_PATH,
        locator: 'Sample - Client Research Note.md §Preliminary Analysis + §Verification Reminder',
        verified: true,
      },
    ],
  },
};

// ── Consulting demo answers ─────────────────────────────────────────────────
// Source: Sample - Engagement Summary.md (Hartwell Distribution Co.)

const ENGAGEMENT_SUMMARY_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_ENGAGEMENT_SUMMARY}`;
const ENGAGEMENT_SUMMARY_LABEL = SAMPLE_FILE_ENGAGEMENT_SUMMARY;

const CONSULTING_DEMO_ANSWERS_MAP: Record<string, DemoAnswer> = {
  'What are the key findings so far?': {
    answer:
      'I have identified four significant findings in the Hartwell engagement. {1} The Springfield facility averages 2.7 days to pick, pack, and ship versus 1.4 days at Columbus -- and the difference is the WMS, not staffing. Springfield runs a 14-year-old system that requires manual pick-list printing. Second, month-end inventory reconciliation shows a consistent 3 to 4% variance at Springfield, which the data pattern suggests is a data-entry problem in receiving rather than cycle-count procedures. Third, 22% of customer escalations over the last six months trace to split-shipment confusion where items ordered as a set ship from different facilities on different days. Fourth, only three people at Springfield understand the legacy WMS well enough to configure it, and one is eligible to retire in 2027. {1}',
    citations: [
      {
        n: 1,
        label: ENGAGEMENT_SUMMARY_LABEL,
        excerpt:
          '1. Order fulfillment lag. The Springfield facility averages 2.7 days to pick, pack, and ship. The Columbus facility averages 1.4 days. The difference is not staffing -- it is the WMS. Springfield runs a 14-year-old system that requires manual pick-list printing. Columbus uses the newer platform acquired with the 2023 Brentwood deal.\n\n' +
          '2. Inventory discrepancies. Month-end reconciliation reveals a consistent 3 to 4% variance between recorded and physical inventory at Springfield. Hartwell\'s operations director attributes this to cycle-count procedures, but the data pattern suggests a data entry problem in the receiving workflow.\n\n' +
          '3. Customer service escalations. 22% of escalations over the last six months trace back to split-shipment confusion -- items ordered as a set ship from different facilities on different days, and the customer receives no consolidated tracking.\n\n' +
          '4. Staff knowledge concentration. Three people at Springfield understand the legacy WMS deeply enough to configure it. One is eligible to retire in 2027.',
        path: ENGAGEMENT_SUMMARY_PATH,
        locator: 'Sample - Engagement Summary.md §Key Findings So Far',
        verified: true,
      },
    ],
  },

  'What is the engagement scope?': {
    answer:
      'The Hartwell engagement is a 90-day operating model review and fulfillment optimization project. {1} Hartwell is a 180-person regional distributor of industrial supplies across six states with approximately $94M in annual revenue. The company grew by acquisition over four years and now operates two legacy warehouse management systems that do not talk to each other. My scope is to assess current-state operations across both facilities, identify the top 5 to 7 friction points driving cost or delivery failures, and produce a 90-day roadmap for the consolidation decision. {1}',
    citations: [
      {
        n: 1,
        label: ENGAGEMENT_SUMMARY_LABEL,
        excerpt:
          'Hartwell Distribution is a 180-person regional distributor of industrial supplies across six states. Revenue is approximately $94M annually. The company has grown by acquisition over four years and now operates two legacy warehouse management systems that do not talk to each other. The CEO wants a clear picture of where the operating model breaks down, a prioritized set of recommendations, and a realistic path to consolidating onto a single WMS within 18 months.\n\nOur scope: assess current-state operations across the two facilities, identify the top 5 to 7 friction points driving cost or delivery failures, and produce a 90-day roadmap for the consolidation decision.',
        path: ENGAGEMENT_SUMMARY_PATH,
        locator: 'Sample - Engagement Summary.md §Engagement Objective',
        verified: true,
      },
    ],
  },

  'What are the next steps for Hartwell?': {
    answer:
      'There are five immediate next steps. {1} First, complete the time-motion study at Springfield with field visits on April 8 to 9. Second, interview the Columbus operations lead about the Brentwood integration -- specifically what was hard and what was lost. Third, request 12 months of order data from both facilities for throughput modeling. Fourth, draft the consolidation options memo covering three scenarios: expand the Columbus WMS to Springfield, move to a third-party platform, or go hybrid. Fifth, schedule a readout with the CEO and CFO for April 25. {1}',
    citations: [
      {
        n: 1,
        label: ENGAGEMENT_SUMMARY_LABEL,
        excerpt:
          '- [ ] Complete the time-motion study at Springfield (field visits April 8 to 9)\n' +
          '- [ ] Interview the Columbus operations lead about the Brentwood integration -- what was hard, what was lost\n' +
          '- [ ] Request 12 months of order data from both facilities for throughput modeling\n' +
          '- [ ] Draft the consolidation options memo (expand Columbus WMS to Springfield vs. third-party platform vs. hybrid)\n' +
          '- [ ] Schedule readout with CEO and CFO for April 25',
        path: ENGAGEMENT_SUMMARY_PATH,
        locator: 'Sample - Engagement Summary.md §Next Steps',
        verified: true,
      },
    ],
  },

  'Why does the Springfield facility have a longer fulfillment lag?': {
    answer:
      'The fulfillment lag at Springfield is a WMS problem, not a staffing problem. {1} Springfield averages 2.7 days to pick, pack, and ship while Columbus averages 1.4 days. Springfield runs a 14-year-old warehouse management system that requires manual pick-list printing -- operators print paper lists, walk the floor, and reconcile by hand. Columbus uses the newer platform acquired with the 2023 Brentwood deal, which automates pick-list routing. The gap is structural and will not close through hiring or scheduling changes alone. {1}',
    citations: [
      {
        n: 1,
        label: ENGAGEMENT_SUMMARY_LABEL,
        excerpt:
          'Order fulfillment lag. The Springfield facility averages 2.7 days to pick, pack, and ship. The Columbus facility averages 1.4 days. The difference is not staffing -- it is the WMS. Springfield runs a 14-year-old system that requires manual pick-list printing. Columbus uses the newer platform acquired with the 2023 Brentwood deal.',
        path: ENGAGEMENT_SUMMARY_PATH,
        locator: 'Sample - Engagement Summary.md §Key Findings So Far (finding 1)',
        verified: true,
      },
    ],
  },
};

// ── Advisor demo answers ─────────────────────────────────────────────────────

const HOUSEHOLD_OVERVIEW_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_HOUSEHOLD_OVERVIEW}`;
const MEETING_NOTES_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_MEETING_NOTES}`;
const PLAN_SUMMARY_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_PLAN_SUMMARY}`;
const EMAIL_THREAD_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_EMAIL_THREAD}`;
const BENEFICIARY_ESTATE_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_BENEFICIARY_ESTATE}`;
const ACCOUNT_SUMMARY_PATH = `${PLACEHOLDER_ROOT}/${SAMPLE_FILE_ACCOUNT_SUMMARY}`;

const HOUSEHOLD_OVERVIEW_LABEL = SAMPLE_FILE_HOUSEHOLD_OVERVIEW;
const MEETING_NOTES_LABEL = SAMPLE_FILE_MEETING_NOTES;
const PLAN_SUMMARY_LABEL = SAMPLE_FILE_PLAN_SUMMARY;
const EMAIL_THREAD_LABEL = SAMPLE_FILE_EMAIL_THREAD;
const BENEFICIARY_ESTATE_LABEL = SAMPLE_FILE_BENEFICIARY_ESTATE;
const ACCOUNT_SUMMARY_LABEL = SAMPLE_FILE_ACCOUNT_SUMMARY;

const ADVISOR_DEMO_ANSWERS_MAP: Record<string, DemoAnswer> = {
  'What did we decide about the Roth conversion?': {
    answer:
      'In the April 10, 2024 meeting the Hendricks agreed to convert approximately $48,000 of Robert\'s rollover IRA to a Roth IRA this calendar year. {1} That amount takes them to the top of the 24% bracket without hitting the 32% rate. Robert will initiate the conversion at Schwab in Q4 once the Holistiplan projections are finalised. {1} The estimated federal tax on the conversion is around $11,500, with projected long-term savings of $38,000 to $62,000 in reduced RMD tax and Medicare costs over 10 years. {2}',
    citations: [
      {
        n: 1,
        label: MEETING_NOTES_LABEL,
        excerpt:
          'Roth conversion: We agreed to convert a portion of Robert\'s rollover IRA to a Roth IRA this year. The target conversion amount is approximately $48,000, which takes them to the top of the 24% bracket without triggering the 32% rate.',
        path: MEETING_NOTES_PATH,
        locator: 'Sample - Meeting Notes.md §Decisions Made',
        verified: true,
      },
      {
        n: 2,
        label: PLAN_SUMMARY_LABEL,
        excerpt:
          '2024 target conversion: $48,000 (fills the 24% bracket based on projected income). Estimated federal tax on conversion: ~$11,500. Projected long-term tax savings: $38,000 to $62,000 in reduced RMD tax and Medicare surcharges over 10 years.',
        path: PLAN_SUMMARY_PATH,
        locator: 'Sample - Plan Summary.md §Roth Conversion Strategy',
        verified: true,
      },
    ],
  },
  "What are the Hendricks' top goals?": {
    answer:
      'The Hendricks have four main goals. {1} First, Robert wants to fully retire at 66 and Susan at 64 -- the target is complete income replacement from their portfolio and Social Security by 2026. Second, they want to seed 529 plans for each of their three grandchildren (ages 2, 4, and 7) with $30,000 per account over the next three years. Third, they plan to fund a charitable remainder trust with $250,000 to support a scholarship at Susan\'s alma mater before she retires. Fourth, they want to maintain their current monthly spending of around $9,200 in early retirement. {1}',
    citations: [
      {
        n: 1,
        label: HOUSEHOLD_OVERVIEW_LABEL,
        excerpt:
          'Goals: 1. Retire at 66 (Robert) and 64 (Susan). 2. Fund grandchildren\'s 529 plans. Three grandchildren, ages 2, 4, and 7. They want to seed each account with $30,000 over the next three years. 3. Leave a legacy. They have earmarked $250,000 for a charitable remainder trust. 4. Maintain current lifestyle. Monthly spending is approximately $9,200.',
        path: HOUSEHOLD_OVERVIEW_PATH,
        locator: 'Sample - Household Overview.md §Goals',
        verified: true,
      },
    ],
  },
  'What is their risk tolerance?': {
    answer:
      'The Hendricks score 58 out of 100 on the DataPoints risk tolerance scale, putting them in the moderate range. {1} Their risk capacity is high -- they carry no debt and have two income sources running through 2026 with Social Security available to both. Risk composure is more mixed: Robert is comfortable with short-term volatility, but Susan was unsettled by the 2022 drawdown and prefers a calmer portfolio ride. {1} Their current allocation is 65% equities, 30% bonds, and 5% cash. The target shifts to 60/35/5 at Susan\'s retirement. {1}',
    citations: [
      {
        n: 1,
        label: HOUSEHOLD_OVERVIEW_LABEL,
        excerpt:
          'Risk tolerance score: 58 out of 100 (moderate). Risk capacity: High -- no debt, two income sources through 2026, Social Security available to both. Risk composure: Moderate -- Robert is comfortable with short-term volatility; Susan prefers a calmer ride and was unsettled by the 2022 drawdown. Current allocation: 65% equities / 30% bonds / 5% cash. Target allocation: 60% equities / 35% bonds / 5% cash.',
        path: HOUSEHOLD_OVERVIEW_PATH,
        locator: 'Sample - Household Overview.md §Risk Profile (DataPoints)',
        verified: true,
      },
    ],
  },
  'What is coming up for this household?': {
    answer:
      'Several things are in motion. Robert needs to update his beneficiary designations at Schwab before their daughter\'s wedding in June -- his IRA and taxable brokerage still list his mother, who passed in September 2022. {1} The portfolio has drifted from the 65/35 target to 68/32 due to equity growth, so we need to rebalance within 60 days. {1} The Roth conversion documents need to be prepared for Q4 execution. {1} For 2025, the priorities are an LTC insurance review before Susan\'s school district group coverage lapses at retirement, and revisiting 529 funding once retirement income is confirmed. {2} The charitable remainder trust referral to an estate attorney is pending. {1}',
    citations: [
      {
        n: 1,
        label: MEETING_NOTES_LABEL,
        excerpt:
          'Action items: Robert to update beneficiary designations at Schwab before June. Advisor to prepare Roth conversion authorization documents for Q4 execution. Advisor to schedule LTC specialist call for May. Rebalance portfolio to 65/35 within 60 days. Revisit 529 funding strategy at October meeting.',
        path: MEETING_NOTES_PATH,
        locator: 'Sample - Meeting Notes.md §Action Items',
        verified: true,
      },
      {
        n: 2,
        label: HOUSEHOLD_OVERVIEW_LABEL,
        excerpt:
          'Open items: Complete Roth conversion analysis. Update beneficiary designations on all accounts. Review 529 funding strategy. Finalize charitable remainder trust structure. Collect Susan\'s pension estimate letter. Review long-term care insurance options.',
        path: HOUSEHOLD_OVERVIEW_PATH,
        locator: 'Sample - Household Overview.md §Open Items',
        verified: true,
      },
    ],
  },

  'Whose beneficiaries need updating?': {
    answer:
      'The beneficiary issue has been resolved. Robert\'s rollover IRA and taxable brokerage account both previously listed his mother, Margaret Hendricks, as primary beneficiary. She passed in September 2022. {1} Robert and Susan updated both accounts at Schwab on May 29, 2024, confirmed via email the same day. Susan is now primary on both accounts; the three grandchildren are listed as equal contingent beneficiaries. {1} Two items still need attention: the beneficiary designations on Robert\'s consulting 401(k) have not been verified, and Susan\'s 403(b) designations are administered by the school district HR office rather than Schwab and need a separate confirmation. {2} Once the Roth IRA is opened after the Q4 conversion, beneficiary designations should be established immediately. {2}',
    citations: [
      {
        n: 1,
        label: EMAIL_THREAD_LABEL,
        excerpt:
          'Done. Robert logged into Schwab and updated both accounts: the rollover IRA and the taxable brokerage. Susan is primary on both; the three grandchildren are listed as equal contingent beneficiaries. He printed the confirmation pages and we have copies.',
        path: EMAIL_THREAD_PATH,
        locator: 'Sample - Email Thread.md §Email 5',
        verified: true,
      },
      {
        n: 2,
        label: BENEFICIARY_ESTATE_LABEL,
        excerpt:
          'Confirm Robert\'s consulting 401(k) beneficiary designations match the intended primary/contingent lineup. Confirm Susan\'s 403(b) beneficiary designations with school district HR. Once the Roth IRA is opened (post-conversion in Q4 2024), establish beneficiary designations immediately.',
        path: BENEFICIARY_ESTATE_PATH,
        locator: 'Sample - Beneficiary & Estate Notes.md §Estate Planning Gaps and Next Actions',
        verified: true,
      },
    ],
  },

  'How are the accounts currently allocated?': {
    answer:
      'The Hendricks hold approximately $2,362,000 across five accounts, all custodied at Schwab. {1} The largest position is Robert\'s rollover IRA at roughly $1,400,000. Susan\'s school district 403(b) holds approximately $520,000. The joint taxable brokerage holds around $380,000, and Robert\'s consulting 401(k) holds about $62,000. A Roth IRA will be opened after the Q4 2024 conversion. {1} The current portfolio allocation is approximately 68% equities, 30% bonds, and 2% cash, which has drifted from the 65/30/5 working target due to equity market gains in 2023. A rebalance back to 65/35/5 is planned within 60 days of the April 2024 meeting, with a further shift to 60/35/5 planned at Susan\'s retirement in 2026. {2}',
    citations: [
      {
        n: 1,
        label: ACCOUNT_SUMMARY_LABEL,
        excerpt:
          'Rollover IRA (Robert): $1,400,000. Taxable Brokerage (Joint): $380,000. Consulting 401(k) (Robert): $62,000. 403(b) (Susan): $520,000. Total approximate household portfolio: $2,362,000.',
        path: ACCOUNT_SUMMARY_PATH,
        locator: 'Sample - Account Summary.md §Account Holdings',
        verified: true,
      },
      {
        n: 2,
        label: ACCOUNT_SUMMARY_LABEL,
        excerpt:
          'Current Allocation: Equities 68% (target 60%, drift +8%); Bonds/Fixed Income 30% (target 35%, drift -5%); Cash 2% (target 5%, drift -3%). The rebalance will bring equities back to 65% in the near term, with a planned shift to the 60/35/5 target at Susan\'s retirement (2026).',
        path: ACCOUNT_SUMMARY_PATH,
        locator: 'Sample - Account Summary.md §Current vs. Target Allocation',
        verified: true,
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Profession -> answers map
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_ANSWERS_BY_PROFESSION: Record<Profession, Record<string, DemoAnswer>> = {
  legal: LEGAL_DEMO_ANSWERS_MAP,
  tax: TAX_DEMO_ANSWERS_MAP,
  consulting: CONSULTING_DEMO_ANSWERS_MAP,
  advisor: ADVISOR_DEMO_ANSWERS_MAP,
  other: LEGAL_DEMO_ANSWERS_MAP,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the demo answer for a question string within a given profession.
 * Matching is case-insensitive and trims leading/trailing whitespace.
 * Returns `null` if the question does not match any demo question for that profession.
 */
export function getDemoAnswer(question: string, profession?: Profession): DemoAnswer | null {
  const prof: Profession = profession ?? getProfession();
  const map = DEMO_ANSWERS_BY_PROFESSION[prof];
  const normalised = question.trim().toLowerCase();
  for (const [key, answer] of Object.entries(map)) {
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
 * Convenience: get and resolve in one call.
 *
 * When `profession` is not supplied, resolves from the current store value via
 * `getProfession()` so the demo branch in Ask can stay profession-aware
 * without passing the profession explicitly.
 *
 * Returns `null` if the question has no matching demo answer for that profession.
 */
export function getDemoAnswerForWorkspace(
  question: string,
  workspaceRoot: string,
  profession?: Profession,
): DemoAnswer | null {
  const raw = getDemoAnswer(question, profession);
  if (!raw) return null;
  return resolveDemoAnswerPaths(raw, workspaceRoot);
}

// Re-export path helpers so callers can build citation paths without
// duplicating the separator logic.
export { sampleFilePath as buildSampleFilePath };
export const DEMO_SAMPLE_FILES = [SAMPLE_FILE_MATTER_OVERVIEW, SAMPLE_FILE_WEEKLY_REVIEW] as const;

// Also re-export the weekly review path builder for future answers that cite it.
export { WEEKLY_REVIEW_PATH as DEMO_WEEKLY_REVIEW_PLACEHOLDER_PATH };
