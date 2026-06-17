/**
 * Feature tour steps shown AFTER the first-run wizard completes.
 *
 * 7-step onboarding sequence for Keepance 3.0's Spine navigation.
 * Target selectors: data-testid first, fallback to CSS selector.
 * Placement: 'top' | 'bottom' | 'left' | 'right' | 'center' (center
 * = modal-in-the-middle, for intro + outro steps).
 */
export interface FeatureTourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector or data-testid-selector for the element to highlight. */
  targetSelector: string | null;  // null = center modal
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export const FEATURE_TOUR_STEPS: FeatureTourStep[] = [
  {
    id: 'intro',
    title: 'A quick look at the new layout',
    body: 'Keepance 3.0 is built around matters, not files. This tour covers the six things worth knowing. Skip any time with Esc, step back with the left arrow key. You can restart from Settings, Onboarding.',
    targetSelector: null,
    placement: 'center',
  },
  {
    id: 'matters',
    title: 'Matters first',
    body: 'Every client and case gets its own matter. Your documents, emails, and AI conversations stay inside the matter boundary so the wrong client never sees the wrong file. Create a matter from the Matters view or the plus button in the header.',
    targetSelector: '[data-testid="spine-nav-matters"]',
    placement: 'right',
  },
  {
    id: 'ask',
    title: 'Search finds anything in your files',
    body: 'Type a question, a clause, a client name, or a case number. Search looks across every document and email in your workspace and answers with citations you can click back to the source. It also runs full AI conversations when you need them.',
    targetSelector: '[data-testid="spine-nav-search"]',
    placement: 'right',
  },
  {
    id: 'documents',
    title: 'Your documents, as real files',
    body: 'Word documents, Markdown, PDFs, transcripts: all stored as real files on your disk. Every edit saves automatically and keeps a version history. Back them up with Time Machine, File History, or any folder sync tool you already use.',
    targetSelector: '[data-testid="spine-nav-files"]',
    placement: 'right',
  },
  {
    id: 'email',
    title: 'Email lives here now',
    body: 'Connect your Microsoft 365 or Gmail inbox and Keepance imports your matter-related emails, lets you search across them, and cites them in your answers. Your email stays encrypted on your machine; nothing is uploaded to Keepance servers.',
    targetSelector: '[data-testid="spine-nav-email"]',
    placement: 'right',
  },
  {
    id: 'audit',
    title: 'Activity Log',
    body: 'Every AI action is logged: the prompt, the model, the response, and the cost. If a client ever asks what the AI did with their documents, this is your answer. Filter by date, export to CSV, or print it for the file.',
    targetSelector: '[data-testid="spine-nav-audit"]',
    placement: 'right',
  },
  {
    id: 'outro',
    title: 'You are all set',
    body: 'Start by creating a matter and opening a document. The AI key setup is in Settings, AI if you have not added one yet. Your data never leaves your machine without your knowledge. Build something good.',
    targetSelector: null,
    placement: 'center',
  },
];
