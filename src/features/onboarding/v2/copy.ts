import i18n from '@/i18n';

type TranslateLike = (key: string, options?: Record<string, unknown>) => unknown;

const defaultTranslate: TranslateLike = (key, options) => (
  options === undefined ? i18n.t(key) : i18n.t(key, options)
);
const key = (leaf: string) => `onboarding.v2.${leaf}`;
const text = (t: unknown, leaf: string, options?: Record<string, unknown>) => {
  const translate = t as TranslateLike;
  const value = options === undefined ? translate(key(leaf)) : translate(key(leaf), options);
  return typeof value === 'string' ? value : String(value);
};

/**
 * Central copy map for the V2 onboarding flow.
 *
 * Components pass their live `t()` function so locale changes still work.
 * Tests use ONB_COPY, the English/default snapshot of the same translation
 * keys, to keep exact-copy assertions simple.
 */
export function getOnboardingV2Copy(t: unknown = defaultTranslate) {
  return {
    nav: {
      dialogLabel: text(t, 'nav.dialog-label'),
      back: text(t, 'nav.back'),
      continue: text(t, 'nav.continue'),
      goToStep: (step: number) => text(t, 'nav.go-to-step', { step }),
      close: text(t, 'nav.close'),
    },

    intro: {
      headline: text(t, 'intro.headline'),
      flow: [
        {
          title: text(t, 'intro.flow.connect.title'),
          body: text(t, 'intro.flow.connect.body'),
        },
        {
          title: text(t, 'intro.flow.client-map.title'),
          body: text(t, 'intro.flow.client-map.body'),
        },
        {
          title: text(t, 'intro.flow.ask.title'),
          body: text(t, 'intro.flow.ask.body'),
        },
      ],
      trustLine: text(t, 'intro.trust-line'),
      helpLine: text(t, 'intro.help-line'),
      cta: text(t, 'intro.cta'),
    },

    choose: {
      headline: text(t, 'choose.headline'),
      help: text(t, 'choose.help'),
      sample: {
        badge: text(t, 'choose.sample.badge'),
        title: text(t, 'choose.sample.title'),
        help: text(t, 'choose.sample.help'),
        bullets: [
          text(t, 'choose.sample.bullet-1'),
          text(t, 'choose.sample.bullet-2'),
          text(t, 'choose.sample.bullet-3'),
        ],
        loading: text(t, 'choose.sample.loading'),
        cta: text(t, 'choose.sample.cta'),
      },
      own: {
        title: text(t, 'choose.own.title'),
        help: text(t, 'choose.own.help'),
        bullets: [
          text(t, 'choose.own.bullet-1'),
          text(t, 'choose.own.bullet-2'),
          text(t, 'choose.own.bullet-3'),
        ],
        loading: text(t, 'choose.own.loading'),
        cta: text(t, 'choose.own.cta'),
      },
      error: text(t, 'choose.error'),
    },

    compliance: {
      headline: text(t, 'compliance.headline'),
      body: text(t, 'compliance.body'),
      points: [
        text(t, 'compliance.point-1'),
        text(t, 'compliance.point-2'),
        text(t, 'compliance.point-3'),
      ],
      cta: text(t, 'compliance.cta'),
      modalTitle: text(t, 'compliance.modal-title'),
      modalBody: text(t, 'compliance.modal-body'),
      modalCta: text(t, 'compliance.modal-cta'),
    },

    ai: {
      headline: text(t, 'ai.headline'),
      modeNote: text(t, 'ai.mode-note'),
      providers: {
        openai: text(t, 'ai.providers.openai'),
        anthropic: text(t, 'ai.providers.anthropic'),
        google: text(t, 'ai.providers.google'),
      },
      cloud: {
        title: text(t, 'ai.cloud.title'),
        bullets: [
          text(t, 'ai.cloud.bullet-1'),
          text(t, 'ai.cloud.bullet-2'),
          text(t, 'ai.cloud.bullet-3'),
          text(t, 'ai.cloud.bullet-4'),
          text(t, 'ai.cloud.bullet-5'),
        ],
        whatLink: text(t, 'ai.cloud.what-link'),
        pickLabel: text(t, 'ai.cloud.pick-label'),
        connect: text(t, 'ai.cloud.connect'),
        connecting: text(t, 'ai.cloud.connecting'),
        connected: text(t, 'ai.cloud.connected'),
        saved: text(t, 'ai.cloud.saved'),
      },
      steps: {
        openPrefix: text(t, 'ai.steps.open-prefix'),
        openLink: (provider: string) => text(t, 'ai.steps.open-link', { provider }),
        openSuffix: text(t, 'ai.steps.open-suffix'),
        createKey: text(t, 'ai.steps.create-key'),
        pasteKey: text(t, 'ai.steps.paste-key'),
      },
      keyPlaceholder: (provider: string) => text(t, 'ai.key-placeholder', { provider }),
      errorEmpty: text(t, 'ai.error-empty'),
      errorSave: text(t, 'ai.error-save'),
      connectedStatus: text(t, 'ai.connected-status'),
      savedUnverified: (provider: string) => text(t, 'ai.saved-unverified', { provider }),
      local: {
        title: text(t, 'ai.local.title'),
        bullets: [
          text(t, 'ai.local.bullet-1'),
          text(t, 'ai.local.bullet-2'),
          text(t, 'ai.local.bullet-3'),
          text(t, 'ai.local.bullet-4'),
          text(t, 'ai.local.bullet-5'),
        ],
        moreLink: text(t, 'ai.local.more-link'),
        tryLocal: text(t, 'ai.local.try-local'),
        switchNote: text(t, 'ai.local.switch-note'),
      },
      ollama: {
        title: text(t, 'ai.ollama.title'),
        modelInstalled: (count: number) => text(t, 'ai.ollama.model-installed', { count }),
        suffix: text(t, 'ai.ollama.suffix'),
        useOllama: text(t, 'ai.ollama.use-ollama'),
        localReady: text(t, 'ai.ollama.local-ready'),
        startingDownload: text(t, 'ai.ollama.starting-download'),
        downloadBuiltIn: text(t, 'ai.ollama.download-built-in'),
      },
      payModal: {
        title: text(t, 'ai.pay-modal.title'),
        body: text(t, 'ai.pay-modal.body'),
        got: text(t, 'ai.pay-modal.got'),
      },
      localModal: {
        title: text(t, 'ai.local-modal.title'),
        body: text(t, 'ai.local-modal.body'),
        got: text(t, 'ai.local-modal.got'),
      },
    },

    connect: {
      headline: text(t, 'connect.headline'),
      pills: [
        text(t, 'connect.pills.encrypted'),
        text(t, 'connect.pills.device'),
        text(t, 'connect.pills.private'),
      ],
      cards: {
        m365: {
          title: text(t, 'connect.cards.m365.title'),
          description: text(t, 'connect.cards.m365.description'),
        },
        gmail: {
          title: text(t, 'connect.cards.gmail.title'),
          description: text(t, 'connect.cards.gmail.description'),
        },
        onedrive: {
          title: text(t, 'connect.cards.onedrive.title'),
          description: text(t, 'connect.cards.onedrive.description'),
        },
        calendar: {
          title: text(t, 'connect.cards.calendar.title'),
          description: text(t, 'connect.cards.calendar.description'),
        },
        wealthbox: {
          title: text(t, 'connect.cards.wealthbox.title'),
          description: text(t, 'connect.cards.wealthbox.description'),
        },
        imap: {
          toggle: text(t, 'connect.cards.imap.toggle'),
          title: text(t, 'connect.cards.imap.title'),
          description: text(t, 'connect.cards.imap.description'),
        },
      },
      badges: {
        readsIn: text(t, 'connect.badges.reads-in'),
        twoWay: text(t, 'connect.badges.two-way'),
      },
      groups: {
        nowLabel: text(t, 'connect.groups.now-label'),
        builtLabel: text(t, 'connect.groups.built-label'),
        roadmapLabel: text(t, 'connect.groups.roadmap-label'),
        calendarsNote: text(t, 'connect.groups.calendars-note'),
      },
      built: {
        salesforce: {
          name: text(t, 'connect.built.salesforce.name'),
          desc: text(t, 'connect.built.salesforce.desc'),
        },
        redtail: {
          name: text(t, 'connect.built.redtail.name'),
          desc: text(t, 'connect.built.redtail.desc'),
        },
        docusign: {
          name: text(t, 'connect.built.docusign.name'),
          desc: text(t, 'connect.built.docusign.desc'),
        },
        addepar: {
          name: text(t, 'connect.built.addepar.name'),
          desc: text(t, 'connect.built.addepar.desc'),
        },
        box: {
          name: text(t, 'connect.built.box.name'),
          desc: text(t, 'connect.built.box.desc'),
        },
        sharefile: {
          name: text(t, 'connect.built.sharefile.name'),
          desc: text(t, 'connect.built.sharefile.desc'),
        },
        jotform: {
          name: text(t, 'connect.built.jotform.name'),
          desc: text(t, 'connect.built.jotform.desc'),
        },
        zocks: {
          name: text(t, 'connect.built.zocks.name'),
          desc: text(t, 'connect.built.zocks.desc'),
        },
      },
      comingSoonLabel: text(t, 'connect.coming-soon-label'),
      worksWith: {
        title: text(t, 'connect.works-with.title'),
        body: text(t, 'connect.works-with.body'),
        disclaimer: text(t, 'connect.works-with.disclaimer'),
      },
    },

    firm: {
      headline: text(t, 'firm.headline'),
      sub: text(t, 'firm.sub'),
      yourAi: text(t, 'firm.your-ai'),
      importing: text(t, 'firm.importing'),
      aiLabel: text(t, 'firm.ai-label'),
      aiRetryLabel: text(t, 'firm.ai-retry-label'),
      aiUnverifiedLabel: text(t, 'firm.ai-unverified-label'),
      aiCloudReadyLabel: text(t, 'firm.ai-cloud-ready-label'),
      clientMapTitle: text(t, 'firm.client-map-title'),
      clientMapSub: text(t, 'firm.client-map-sub'),
      clientMapNote: text(t, 'firm.client-map-note'),
      asksHeader: text(t, 'firm.asks-header'),
      idle: text(t, 'firm.idle'),
      cta: text(t, 'firm.cta'),
      status: {
        failed: text(t, 'firm.status.failed'),
        done: text(t, 'firm.status.done'),
        working: text(t, 'firm.status.working'),
        notStarted: text(t, 'firm.status.not-started'),
        notVerified: text(t, 'firm.status.not-verified'),
        retrying: text(t, 'firm.status.retrying'),
        retry: text(t, 'firm.status.retry'),
      },
      rows: {
        email: text(t, 'firm.rows.email'),
        wealthbox: text(t, 'firm.rows.wealthbox'),
        oneDrive: text(t, 'firm.rows.onedrive'),
        files: text(t, 'firm.rows.files'),
        imported: (count: number) => text(t, 'firm.rows.imported', { count }),
        checked: (count: number) => text(t, 'firm.rows.checked', { count }),
        households: (count: number) => text(t, 'firm.rows.households', { count }),
      },
      questions: [
        text(t, 'firm.questions.q1'),
        text(t, 'firm.questions.q2'),
        text(t, 'firm.questions.q3'),
        text(t, 'firm.questions.q4'),
        text(t, 'firm.questions.q5'),
        text(t, 'firm.questions.q6'),
        text(t, 'firm.questions.q7'),
        text(t, 'firm.questions.q8'),
        text(t, 'firm.questions.q9'),
        text(t, 'firm.questions.q10'),
        text(t, 'firm.questions.q11'),
        text(t, 'firm.questions.q12'),
        text(t, 'firm.questions.q13'),
        text(t, 'firm.questions.q14'),
        text(t, 'firm.questions.q15'),
        text(t, 'firm.questions.q16'),
      ],
    },
  } as const;
}

export const ONB_COPY = getOnboardingV2Copy();

/**
 * "Coming soon" connector logos for the data screen, grayed out in order.
 * Files live under /public/onboarding/logos.
 */
export const ONB_COMING_SOON_LOGOS: readonly { name: string; file: string }[] = [
  { name: 'eMoney', file: 'emoney.svg' },
  { name: 'MoneyGuidePro', file: 'moneyguidepro.svg' },
  { name: 'Holistiplan', file: 'holistiplan.png' },
  { name: 'Orion', file: 'orion.svg' },
  { name: 'Tamarac', file: 'tamarac.svg' },
  { name: 'Nitrogen', file: 'nitrogen.svg' },
];
