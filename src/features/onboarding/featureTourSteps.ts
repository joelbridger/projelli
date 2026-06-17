/**
 * Feature tour steps shown AFTER the first-run wizard completes.
 *
 * 11-step onboarding sequence for Keepance 3.0's Spine navigation.
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
    body: 'Keepance 3.0 is built around matters, not files. This tour covers the main areas worth knowing. Skip any time with Esc, step back with the left arrow key. You can restart from Settings, Onboarding.',
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
    id: 'workflows',
    title: 'Workflows run your repeatable tasks',
    body: 'A workflow is a multi-step task you define once and run whenever you need it: drafting a demand letter, running a conflict check, building a client summary. Every run is saved with its inputs and outputs so you can replay it or hand it to a colleague.',
    targetSelector: '[data-testid="spine-nav-workflows"]',
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
    id: 'privacy',
    title: 'Privacy Center',
    body: 'This is where you can see exactly where your data lives and what, if anything, leaves your machine. You can run a one-click confidentiality report that lists every data store and every outbound connection. It\'s the plain answer to "where does my clients\' data go."',
    targetSelector: '[data-testid="spine-nav-privacy"]',
    placement: 'right',
  },
  {
    id: 'settings',
    title: 'Settings',
    body: 'Your AI connection lives here: add your own API key, switch to a local model, or set up your firm\'s proxy. You can also configure your email account, firm details, and general preferences. If something isn\'t working, Settings is the first place to check.',
    targetSelector: '[data-testid="spine-nav-settings"]',
    placement: 'right',
  },
  {
    id: 'account',
    title: 'Your account',
    body: 'Your profile, plan, and seat are here. Sign in and out, see your current subscription, and manage your license. If you\'re on a firm plan, your admin can add or remove seats from the same spot.',
    targetSelector: '[data-testid="account-identity"]',
    placement: 'right',
  },
  {
    id: 'outro',
    title: 'You are all set',
    body: 'Start by creating a matter and opening a document. The AI key setup is in Settings if you have not added one yet. Your data never leaves your machine without your knowledge. Build something good.',
    targetSelector: null,
    placement: 'center',
  },
];
