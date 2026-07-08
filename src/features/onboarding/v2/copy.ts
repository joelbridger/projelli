/**
 * Verbatim copy for OnboardingV2, lifted from the round-8 prototype spec.
 *
 * Centralized so (a) wording stays faithful to the approved design, (b) tests
 * can assert exact strings, and (c) a future i18n pass has one place to work
 * from. No em dashes anywhere (brand rule). SOC 2 is only ever attributed to
 * the AI provider, never to Lantern.
 */

export const ONB_COPY = {
  intro: {
    headline: 'Set up Lantern.',
    sub: 'Use sample data, or connect your own files.',
    flow: [
      'Connect AI',
      'Add files',
      'Ask with sources',
    ],
    pills: [
      'Our servers never see your documents or prompts',
      'Vault: optional AES-256 encryption',
      'Cloud AI providers are SOC 2 certified',
    ],
    cta: 'Start setup',
    sampleTitle: 'Use sample practice',
    ownTitle: 'Use my files',
    recommended: 'Recommended',
    sampleBullets: [
      'A worked household you can explore',
      'A filled, cited Client Map',
      'Nothing leaves your computer',
    ],
    ownBullets: [
      'Pick where your practice lives',
      'Import email, files, and Wealthbox next',
      'Your data stays on this device',
    ],
    sampleCta: 'Use sample practice',
    ownCta: 'Use my files',
  },

  ai: {
    headline: '1. Connect your AI',
    cloud: {
      title: 'Cloud AI',
      bullets: [
        'Uses your own AI account key.',
        'Lantern never sees your key or data.',
        'Usually gives the best answers.',
      ],
      whatLink: 'What does this mean?',
      pickLabel: 'Provider',
      connect: 'Connect',
      helpLink: 'I need help setting this up',
    },
    local: {
      title: 'Local AI',
      bullets: [
        'Runs on this computer.',
        'Nothing leaves.',
        'Needs a larger download.',
      ],
      moreLink: 'What does this mean?',
      tryLocal: 'Try Local AI',
      switchNote: 'Switch to cloud AI anytime',
    },
    payModal: {
      title: 'Pay as you go, with your own key',
      body: 'You get an API key from the AI company you pick (OpenAI, Anthropic, or Google). You pay them directly, only for what you actually use, usually a few cents per question. Lantern never charges you for AI, and never sees your key or your data.',
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
    trustLine: 'Connected data stays on this device.',
    pills: [
      'Encrypted in transit',
      'Stays on your device',
      'Lantern never sees your data',
    ],
    comingSoonLabel: 'More connectors planned',
    connect: 'Connect',
    connected: 'Connected',
    desktopOnly: 'Available in the desktop app',
    // Connector-access: honest "we read your exports" line. Lantern is not
    // integrated with RightCapital or Jump; it reads the files those tools
    // export or sync into the places you just connected. Wording is verified
    // against docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md
    // (the "what we can honestly claim" table) — never "integration".
    worksWith: {
      title: 'Already use RightCapital or Jump?',
      body: 'Lantern also reads the plan reports and meeting notes you export or save from tools like RightCapital and Jump, once they land in the files, email, or folders you just connected. It files each one to the right client, shows when it was exported, and cites it in answers.',
      disclaimer: 'Lantern reads your exported files and saved notes. It is not an official integration with these tools, and their names belong to their owners.',
    },
  },

  firm: {
    headline: '3. Setting up your firm',
    sub: 'You can continue to the app and these will load in the background.',
    yourAi: 'YOUR AI',
    importing: 'IMPORTING YOUR DATA',
    aiLabel: 'Downloading your private AI',
    clientMapTitle: 'Building your Client Maps',
    clientMapSub: 'Assembling the whole story of every client and household.',
    asksHeader: 'Try asking',
    moreExamples: 'More examples',
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
  'Who needs a review this week?',
  'What changed for the Chen household?',
  'Draft an agenda for tomorrow.',
  'Find missing paperwork.',
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
// NOTE (connector-access): RightCapital is intentionally NOT in this list. A
// grayed-out "COMING SOON" logo implies an official integration is on the way,
// which would overclaim — Lantern reads RightCapital's EXPORTED plan PDFs
// today, it does not integrate with it. That capability is stated honestly in
// the "Already use RightCapital or Jump?" callout on the connect screen instead.
// Jump is likewise represented only as a recognized export, never as a logo.
export const ONB_COMING_SOON_LOGOS: readonly { name: string; file: string }[] = [
  { name: 'Redtail', file: 'redtail.svg' },
  { name: 'Salesforce', file: 'salesforce.svg' },
  { name: 'eMoney', file: 'emoney.svg' },
  { name: 'MoneyGuidePro', file: 'moneyguidepro.svg' },
  { name: 'Holistiplan', file: 'holistiplan.png' },
  { name: 'Orion', file: 'orion.svg' },
  { name: 'Tamarac', file: 'tamarac.svg' },
  { name: 'Addepar', file: 'addepar.svg' },
  { name: 'Nitrogen', file: 'nitrogen.svg' },
  { name: 'DocuSign', file: 'docusign.svg' },
];
