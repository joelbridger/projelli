/**
 * Feature tour steps shown AFTER the first-run wizard completes.
 *
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
    title: "Let's take a 60-second tour",
    body: 'Projelli has four big ideas. Skip any time with Esc. You can restart this tour later from Settings, Onboarding.',
    targetSelector: null,
    placement: 'center',
  },
  {
    id: 'file-tree',
    title: 'Your files, on your disk',
    body: 'Every chat, every workflow output, every note lives here as a real Markdown file. Open them with any editor, back them up with git, take them with you. Projelli never holds your files hostage.',
    targetSelector: '[data-testid="feature-tour-target-filetree"]',
    placement: 'right',
  },
  {
    id: 'ai-chat',
    title: 'Talk to Claude, GPT, or Gemini',
    body: 'Press Ctrl+Shift+A (or Cmd+Shift+A on Mac) to open the AI pane. Your API key stays on your machine. Every conversation becomes a file you can edit and cite.',
    targetSelector: '[data-testid="feature-tour-target-ai-tab"]',
    placement: 'left',
  },
  {
    id: 'workflows',
    title: '15 founder workflows',
    body: 'Pricing Strategy, Pitch Deck, Weekly Review, Competitor Analysis. Each template asks you a few questions then produces a polished Markdown artifact. Try the Weekly Review template this Friday.',
    targetSelector: '[data-testid="feature-tour-target-workflows"]',
    placement: 'left',
  },
  {
    id: 'settings',
    title: 'Settings live here',
    body: 'API keys, theme, keyboard shortcuts, cost dashboard, all of it. Press Ctrl+, anytime. You are all set. Build something good.',
    targetSelector: '[data-testid="feature-tour-target-settings"]',
    placement: 'left',
  },
];
