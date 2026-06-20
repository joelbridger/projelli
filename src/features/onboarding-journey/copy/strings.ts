/**
 * strings.ts — single source of truth for on-screen copy in the onboarding journey.
 *
 * Rule: every user-visible string goes here first. Components import from this
 * file rather than inlining text. Later chapters extend the same object.
 *
 * NO em dashes. NO banned words (leverage / delve / seamless / transform /
 * empower / elevate / unlock). Plain, concise English throughout.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

export const JOURNEY_STRINGS = {
  ch1: {
    title: 'Welcome to Keepance',
    body: 'A private workroom where powerful AI helps with your real work. Nothing ever leaves your computer.',
    tagline: "Let's set it up together. About three minutes.",
    startBtn: 'Start',
    sceneLabel: 'Your files, safe on your own computer',
  },

  ch2: {
    title: 'A bit about you',
    professionQuestion: 'What kind of work do you do?',
    professionSub: 'So Keepance speaks your language.',
    professions: [
      { label: 'Legal practice', id: 'legal' },
      { label: 'Tax and accounting', id: 'tax' },
      { label: 'Consulting and strategy', id: 'consulting' },
      { label: 'Financial advisor or wealth', id: 'financial' },
      { label: 'Something else', id: 'other' },
    ] as const,
    nameQuestion: 'What should we call you?',
    namePlaceholder: 'Your name',
    photoLabel: 'Add a photo',
    photoNote: 'This stays on your computer, just for your sidebar.',
    backBtn: 'Back',
    continueBtn: 'Continue',
  },

  ch3: {
    title: 'Your files stay home',
    body: "Most apps copy your work to their servers. Keepance keeps your files on your own computer. We never get a copy.",
    folderQuestion: 'Where should Keepance keep your files?',
    chooseFolderBtn: 'Choose a folder',
    folderNote: 'A synced folder like Dropbox copies files there too. Your most private work is happiest in a folder that stays on this computer.',
    sceneLabel: 'Your files stay on your computer, not in the cloud',
    backBtn: 'Back',
    continueBtn: 'Continue',
  },

  ch4: {
    title: 'Meet the AI',
    body1: "Think of AI as a brain you plug in. Keepance doesn't come with one. You pick yours, and you can change it any time.",
    body2: "Whatever you ask, the AI reads your own files to answer. And it shows its receipts. Every answer points back to the page it came from, so you can check it.",
    sceneLabel: 'The AI reads your files and shows its sources',
    backBtn: 'Back',
    continueBtn: 'Show me my choices',
  },

  ch5: {
    // -----------------------------------------------------------------------
    // 'choose' view
    // -----------------------------------------------------------------------
    choose: {
      title: 'Choose your AI',
      sub: 'One quick choice. There\'s no wrong answer.',

      card1: {
        title: 'Use your own AI account',
        badge: 'Best for legal work',
        body: 'Connect your Claude, OpenAI, or Gemini account. Your questions go straight to them with your key, never through us.',
        /** Fallback cost line shown when no profession is set in data yet. */
        costFallback: 'Most people pay about $2 to $5 a month, to the AI company, not to us.',
      },

      card2: {
        title: 'Keep the AI on your computer',
        badge: 'Most private. A bit less sharp.',
        body: 'A free AI that runs entirely on your machine. Nothing ever leaves. We\'ll set it up for you, no commands to type.',
      },

      card3: {
        title: 'Decide later',
        body: 'Everything works without an AI. Connect one any time in Settings.',
      },
    },

    // -----------------------------------------------------------------------
    // 'cloud' view — connect a cloud account
    // -----------------------------------------------------------------------
    cloud: {
      title: 'Connect your account',
      sub: 'Pick a provider, then paste your account key.',
      saveBtn: 'Save and continue',
      savingBtn: 'Saving...',
      backBtn: 'Other options',
      keyLabel: (providerName: string) => `Paste your ${providerName} account key`,
    },

    // -----------------------------------------------------------------------
    // 'local' view — local Ollama model
    // -----------------------------------------------------------------------
    local: {
      title: 'Keep the AI on your computer',
      sub: 'Nothing ever leaves your machine.',
      readyMsg: 'Local AI is ready.',
      readyDetail: 'You\'re all set to run AI privately on this computer.',
      notReadyMsg: 'We\'ll help you set this up in a moment.',
      notReadyDetail: 'Click below and we\'ll walk you through the whole thing.',
      useLocalBtn: 'Use local AI',
      setupBtn: 'Set it up for me',
      backBtn: 'Other options',

      // --- Guided local setup states (Ch5LocalSetup) ---

      needsInstall: {
        title: 'Let\'s set up your private AI',
        body: 'We\'ll download a free AI that runs entirely on your computer. Nothing ever leaves your machine.',
        btn: 'Set it up for me',
      },

      waiting: {
        msg: 'Waiting for the installer to finish. This continues on its own once it\'s ready.',
      },

      downloading: {
        title: 'Downloading your private AI',
        percentSuffix: '%',
      },

      ready: {
        msg: 'Your private AI is ready.',
        btn: 'Use local AI',
      },

      error: {
        msg: 'Something interrupted the setup.',
        retryBtn: 'Try again',
        openBtn: 'Open Ollama',
      },

      checking: {
        msg: 'Checking your computer...',
      },
    },

    // -----------------------------------------------------------------------
    // 'wrap' view — 465 MB reassurance, shown for every path
    // -----------------------------------------------------------------------
    wrap: {
      title: 'One quick thing',
      body: 'Keepance is setting up a private search of your files, about 465 MB, one time. Like your AI, it runs on your computer and never leaves.',
      continueBtn: 'Continue',
    },
  },
  ch6: {
    title: 'Bring in your email',
    body: 'Keepance can read and search your email next to your files, all on your computer. No more fighting slow inbox search.',
    sceneLabel: 'Your email, searchable on your own computer',
    connectLaterBtn: 'Connect later',
    continueBtn: 'Continue',
  },

  ch7: {
    title: 'Just you, or a team?',
    sceneLabel: 'Solo, or a shared firm workspace',
    soloLabel: 'I work solo',
    soloDescription: 'Everything stays local to your computer.',
    createLabel: 'Create a firm',
    createDescription: 'Set up a shared workspace for your team. You become the admin.',
    joinLabel: 'Join a firm',
    joinDescription: 'Your firm already uses Keepance. Enter your invite code to join.',
    inviteCodeLabel: 'Invite code',
    inviteCodePlaceholder: 'Enter the code your admin sent you',
    changeNote: 'You can change this any time in Settings.',
  },

  ch8: {
    title: "You're set",
    sceneLabel: 'Every answer comes with its sources',
    samplesToggleLabel: 'Add a sample case so I can try things before using real client work.',
    recapLine: 'Your files stay on your computer. Every answer shows its sources. You are in control.',
    continueLabelSamples: 'Open the sample case',
    continueLabelNoSamples: 'Create my first matter',
  },
} as const;

export type JourneyStrings = typeof JOURNEY_STRINGS;
