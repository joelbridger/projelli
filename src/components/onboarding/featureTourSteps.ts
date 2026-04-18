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
    title: "Let's take a 2-minute tour",
    body: 'Projelli has ten things worth knowing on day one. Skip any time with Esc, step back with the left arrow key. You can restart this tour later from Settings, Onboarding.',
    targetSelector: null,
    placement: 'center',
  },
  {
    id: 'file-tree',
    title: 'Your files, on your disk',
    body: 'Every chat, workflow output, and note lives here as a real Markdown file. Every edit auto-saves in two seconds and auto-versions, so nothing is ever lost. Open a file with any editor, back up with git, take it with you anywhere.',
    targetSelector: '[data-testid="sidebar-tab-files"]',
    placement: 'right',
  },
  {
    id: 'ai-chat',
    title: 'Talk to Claude, GPT, Gemini, or Ollama',
    body: 'Press Ctrl+Shift+A to open the AI pane. Bring your own API key; your messages go direct from your machine to the provider, Projelli never proxies them. Type @workspace for memory recall over your files. Hold Ctrl+Shift+Space to dictate with a bundled speech model.',
    targetSelector: '[data-testid="sidebar-tab-ai-assistant"]',
    placement: 'right',
  },
  {
    id: 'workflows',
    title: '15 founder workflows',
    body: 'Pricing Strategy, Pitch Deck, Weekly Review, Competitor Analysis. Each template asks a few questions then produces a polished Markdown artifact you can edit. Try the Weekly Review template this Friday.',
    targetSelector: '[data-testid="sidebar-tab-workflows"]',
    placement: 'right',
  },
  {
    id: 'search',
    title: 'Full-text search across your workspace',
    body: 'Every word of every Markdown file is indexed with MiniSearch so you can jump to the right note by typing a phrase. Results rank by relevance and show the surrounding context.',
    targetSelector: '[data-testid="sidebar-tab-search"]',
    placement: 'right',
  },
  {
    id: 'research',
    title: 'Research mode with source cards',
    body: 'Save a link, quote, and citation as a source card, then drop citations into any doc. Every source stays traceable back to the URL you pulled it from, so your docs are always defensible.',
    targetSelector: '[data-testid="sidebar-tab-research"]',
    placement: 'right',
  },
  {
    id: 'whiteboard',
    title: 'Whiteboard for sketching ideas',
    body: 'A full tldraw canvas lives right next to your docs. Map out a funnel, sketch a system diagram, or mind-map a pitch. Drag a saved whiteboard into a doc and it renders inline.',
    targetSelector: '[data-testid="sidebar-tab-whiteboard"]',
    placement: 'right',
  },
  {
    id: 'audit',
    title: 'Every AI action is logged',
    body: 'The audit log records every prompt, model, token count, and cost so you can trace exactly what the AI did, where, and for how much. Filter by date and model, export to CSV or JSON.',
    targetSelector: '[data-testid="sidebar-tab-audit"]',
    placement: 'right',
  },
  {
    id: 'command-palette',
    title: 'Ctrl+K jumps to anything',
    body: 'The command palette opens files, runs workflows, toggles themes, triggers settings. Fuzzy search by name or by keyboard shortcut. If you prefer keyboard-only, this is the gateway.',
    targetSelector: '[data-testid="command-palette-button"]',
    placement: 'bottom',
  },
  {
    id: 'settings',
    title: 'Settings live here',
    body: 'API keys, theme, keyboard shortcuts, cost dashboard, update channel, voice model, all of it. Press Ctrl+, anytime. You are all set. Build something good.',
    targetSelector: '[data-testid="settings-gear"]',
    placement: 'bottom',
  },
];
