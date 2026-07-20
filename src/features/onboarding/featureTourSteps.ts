/**
 * Feature tour steps shown AFTER the first-run wizard completes.
 *
 * 11-step onboarding sequence for Lantern 3.0's 3-tab Spine navigation
 * (Client Map · Ask · Workflows). The relocated surfaces — Documents, Email,
 * Activity Log, Privacy Center, Settings — are taught against where they now
 * live: inside a client (Client Map), the Ask source filter, and the gear menu.
 * Target selectors: data-testid first, fallback to CSS selector.
 * Placement: 'top' | 'bottom' | 'left' | 'right' | 'center' (center
 * = modal-in-the-middle, for intro + outro steps).
 */
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export interface FeatureTourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector or data-testid-selector for the element to highlight. */
  targetSelector: string | null;  // null = center modal
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const RAW_FEATURE_TOUR_STEPS: FeatureTourStep[] = [
  {
    id: 'intro',
    title: 'A quick look at the new layout',
    body: `${BRAND.name} is built around your clients, not loose files. This tour covers the main areas worth knowing. Skip any time with Esc, step back with the left arrow key. You can restart from Settings, Onboarding.`,
    targetSelector: null,
    placement: 'center',
  },
  {
    id: 'matters',
    title: 'Your Client Map',
    body: `${BRAND.name} leads with your clients, not loose files. Each client gets their own private space, and opening one shows their Client Map: documents, emails, and AI conversations all stay inside that client boundary so the wrong client never sees the wrong file. Create one with the plus button next to Clients.`,
    targetSelector: '[data-testid="spine-nav-matters"]',
    placement: 'right',
  },
  {
    id: 'ask',
    title: 'Ask finds anything in your work',
    body: 'Type a question, a phrase, a client name, or an account number. Ask looks across every document and email in your workspace and answers with citations you can click back to the source. It also runs full AI conversations when you need them.',
    targetSelector: '[data-testid="spine-nav-search"]',
    placement: 'right',
  },
  {
    id: 'documents',
    title: 'Your documents, as real files',
    body: 'Word documents, Markdown, PDFs, transcripts: all stored as real files on your disk, inside the client they belong to. Open a client from the Client Map to see their documents. Every edit saves automatically and keeps a version history you can back up with any folder sync tool.',
    targetSelector: '[data-testid="spine-nav-matters"]',
    placement: 'right',
  },
  {
    id: 'email',
    title: 'Email, imported and searchable',
    body: `Connect your Microsoft 365 or Gmail inbox and ${BRAND.name} imports your client emails. Filter Ask to Email to search across them and cite them in your answers. Your email stays encrypted on your machine; nothing is uploaded to ${BRAND.name} servers.`,
    targetSelector: '[data-testid="spine-nav-search"]',
    placement: 'right',
  },
  {
    id: 'workflows',
    title: 'Workflows run your repeatable tasks',
    body: 'A workflow is a multi-step task you define once and run whenever you need it: drafting a follow-up letter, preparing for a meeting, building a client summary. Every run is saved with its inputs and outputs so you can replay it or hand it to a colleague.',
    targetSelector: '[data-testid="spine-nav-workflows"]',
    placement: 'right',
  },
  {
    id: 'audit',
    title: 'Your Activity Log, in Settings',
    body: 'Open the gear to find your Activity Log. Every AI action is logged: the prompt, the model, the response, and the cost. If a client ever asks what the AI did with their documents, this is your answer. Filter by date, export to CSV, or print it for the file.',
    targetSelector: '[data-testid="settings-gear"]',
    placement: 'bottom',
  },
  {
    id: 'privacy',
    title: 'Your Privacy Center, in Settings',
    body: 'Also under the gear: the Privacy Center shows exactly where your data lives and what, if anything, leaves your machine. Run a one-click confidentiality report that lists every data store and every outbound connection. It\'s the plain answer to "where does my clients\' data go."',
    targetSelector: '[data-testid="settings-gear"]',
    placement: 'bottom',
  },
  {
    id: 'settings',
    title: 'Settings and your AI key',
    body: 'The gear opens Settings. Your AI connection lives here: add your own API key, switch to a local model, or set up your firm\'s proxy. You can also configure your email account, firm details, and general preferences. If something isn\'t working, Settings is the first place to check.',
    targetSelector: '[data-testid="settings-gear"]',
    placement: 'bottom',
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
    body: 'Start by creating a client and opening a document. The AI key setup is in Settings if you have not added one yet. Your documents and prompts stay on this computer unless you choose cloud AI or connect an account, and the Data Map (Settings → Privacy) shows exactly what does leave. Build something good.',
    targetSelector: null,
    placement: 'center',
  },
];

export const FEATURE_TOUR_STEPS: FeatureTourStep[] = RAW_FEATURE_TOUR_STEPS.map((step) => ({
  ...step,
  title: brandText(step.title),
  body: brandText(step.body),
}));
