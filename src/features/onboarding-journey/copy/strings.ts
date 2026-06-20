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
} as const;

export type JourneyStrings = typeof JOURNEY_STRINGS;
