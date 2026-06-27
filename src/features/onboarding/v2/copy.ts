/**
 * Verbatim copy for OnboardingV2, lifted from the round-8 prototype spec.
 *
 * Centralized so (a) wording stays faithful to the approved design, (b) tests
 * can assert exact strings, and (c) a future i18n pass has one place to work
 * from. No em dashes anywhere (brand rule). SOC 2 is only ever attributed to
 * the AI provider, never to Keepance.
 */

export const ONB_COPY = {
  intro: {
    headline: 'A private AI that knows your clients.',
    flow: [
      'Connect your AI and files',
      'Keepance builds Client Maps',
      'Ask anything, with sources',
    ],
    pills: [
      'Keepance stores none of your data',
      'Fully encrypted (AES-256)',
      'AI provider is SOC 2 certified',
    ],
    cta: 'Go!',
  },

  ai: {
    headline: '1. Connect your AI',
    cloud: {
      title: 'Use ChatGPT, Claude, or Gemini',
      bullets: [
        'Keepance never sees your key or your data',
        'Providers are SOC 2 Type 2 certified',
        'Encrypted in transit and at rest',
        "Providers don't train on your data (on paid API usage)",
        'Pay as you go with your own key',
      ],
      whatLink: 'What is this?',
      pickLabel: 'PICK YOUR PROVIDER, THEN GET YOUR KEY',
      connect: 'Connect',
      helpLink: 'I need help setting this up',
    },
    local: {
      title: 'Use local AI',
      bullets: [
        'Runs on your computer',
        'Completely secure (nothing leaves)',
        '2.5 GB download (about 5 minutes)',
        'Great at answering questions about lots of files',
        'Not as great with complex reasoning',
      ],
      moreLink: 'Tell me more',
      tryLocal: 'Try Local AI',
      switchNote: 'Switch to cloud AI anytime',
    },
    payModal: {
      title: 'Pay as you go, with your own key',
      body: 'You get an API key from the AI company you pick (OpenAI, Anthropic, or Google). You pay them directly, only for what you actually use, usually a few cents per question. Keepance never charges you for AI, and never sees your key or your data.',
      got: 'Got it',
    },
    localModal: {
      title: 'Local AI, explained',
      body: "Local AI runs entirely on your own computer. It's free, and fully private, so nothing ever leaves your machine. It's a one time download of about 2.5 GB. It's great at answering questions across lots of your files, though not as strong on complex reasoning. You can switch to cloud AI any time.",
      got: 'Got it',
    },
  },

  connect: {
    headline: '2. Securely connect your data',
    pills: [
      'Encrypted in transit',
      'Stays on your device',
      'Keepance never sees your data',
    ],
    comingSoonLabel: 'COMING SOON',
    connect: 'Connect',
    connected: 'Connected',
    desktopOnly: 'Available in the desktop app',
  },

  firm: {
    headline: '3. Setting up your firm',
    sub: 'You can continue to the app and these will load in the background.',
    yourAi: 'YOUR AI',
    importing: 'IMPORTING YOUR DATA',
    aiLabel: 'Downloading your private AI',
    clientMapTitle: 'Building your Client Maps',
    clientMapSub: 'Assembling the whole story of every client and household.',
    asksHeader: 'Things you can ask Keepance',
    cta: 'Continue to the app',
  },

  nav: {
    back: 'Back',
    continue: 'Continue',
  },
} as const;

/**
 * Example questions previewed on the "Setting up your firm" screen.
 * Verbatim, in order, from the prototype.
 */
export const ONB_EXAMPLE_QUESTIONS: readonly string[] = [
  'Which client is doing a 1031 exchange?',
  'Who has a 529 for the kids?',
  'What changed for the Hendricks since our last review?',
  'Which clients are over-concentrated in one stock?',
  'Who turns 73 this year for RMDs?',
  "Which households haven't been contacted in 90 days?",
  'Who has a CD maturing next month?',
  'Which clients mentioned retiring early?',
  'Who is a good candidate for a Roth conversion?',
  'Which accounts are missing a beneficiary?',
  'Who had a major life event this quarter?',
  'Who has cash sitting uninvested?',
  'Which clients asked about the market last week?',
  'Who is closest to their retirement goal?',
  'Which clients hold concentrated employer stock?',
  'Who mentioned a home purchase or move?',
];

/**
 * "Coming soon" connector logos for the data screen — grayed out, in order.
 * Files live under /public/onboarding/logos.
 */
export const ONB_COMING_SOON_LOGOS: readonly { name: string; file: string }[] = [
  { name: 'Redtail', file: 'redtail.svg' },
  { name: 'Salesforce', file: 'salesforce.svg' },
  { name: 'RightCapital', file: 'rightcapital.svg' },
  { name: 'eMoney', file: 'emoney.svg' },
  { name: 'MoneyGuidePro', file: 'moneyguidepro.svg' },
  { name: 'Holistiplan', file: 'holistiplan.png' },
  { name: 'Orion', file: 'orion.svg' },
  { name: 'Tamarac', file: 'tamarac.svg' },
  { name: 'Addepar', file: 'addepar.svg' },
  { name: 'Nitrogen', file: 'nitrogen.svg' },
  { name: 'DocuSign', file: 'docusign.svg' },
];
