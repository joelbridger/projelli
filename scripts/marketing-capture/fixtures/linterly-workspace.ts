import type { FileNode } from '../../../src/types/workspace';

const ROOT = '/Users/jameson/Keepance/Linterly';

const fileContents: Record<string, string> = {
  'Vision.md': `# Linterly — Vision

Founders who didn't grow up writing English ship product faster when their
investor updates, landing pages, and Slack messages don't trip over grammar.
Linterly is a writing coach that lives in your editor and corrects you the
way a senior PM would: tone-aware, context-aware, deadline-aware.

See [[Customers]] for ICP. See [[Pricing]] for plans.
Voice principles in [[Brand Voice]].`,

  'Pricing.md': `# Linterly Pricing

| Tier | Price | Best for |
|------|-------|----------|
| Free | $0 | First 50 corrections / month |
| Pro  | $19/mo | Unlimited, priority models |
| Team | $49/mo per seat | Shared style guide, billing |

14-day free trial on Pro. Founder discount: 40% off first year for
[[Customers]] who match the ICP. Q1 target in [[Q1 Goals]].`,

  'Customers.md': `# Linterly ICP

Three personas:

1. **Engineer-founder.** Ships product, writes investor updates twice a
   month, freezes on tone. Linterly drafts clean updates from bullet notes.
2. **Indie hacker.** Translates from a non-English first language. Wants
   landing pages that don't feel "translated." Linterly preserves voice
   while fixing grammar.
3. **Operator-CEO.** Writes board updates, customer apologies, hiring
   notes. Wants tone presets — formal, warm, direct.

ICP voice rules in [[Brand Voice]]. Outreach plan in [[Launch Plan]].`,

  'Launch Plan.md': `# Linterly Launch — 8-Week Plan

| Week | Goal | Channels |
|------|------|----------|
| 1    | Landing page live, waitlist open | X, IndieHackers |
| 2    | Beta cohort of 25 | Personal network, Slack groups |
| 3    | Iterate on top 3 pain points | Direct DMs |
| 4    | Public beta, paid signups | Product Hunt soft launch |
| 5    | Press kit + founder essay | TechCrunch tip line, HN |
| 6    | Hard launch | Product Hunt, Show HN |
| 7    | Post-launch retention review | None |
| 8    | First $5K MRR review | None |

Pricing in [[Pricing]]. Customers in [[Customers]]. Goals in [[Q1 Goals]].`,

  'Competitive Analysis.md': `# Competitive Landscape

- **Grammarly** — generalist. Strong on grammar, weak on tone, expensive
  for what it does. Closed model, no BYOK.
- **ProWritingAid** — depth tool. Good for novelists, overkill for
  founder writing.
- **LanguageTool** — open-source, self-hostable. Weak suggestions.

Differentiator (see [[Vision]]): tone-aware, founder-aware, [[Pricing]]
that doesn't punish solo operators.`,

  'Brand Voice.md': `# Brand Voice

Linterly writes the way a senior product manager Slacks: short, specific,
contraction-heavy, never breathless.

**Banned words:** leverage, delve, seamless, transform, empower, elevate,
unlock.
**Banned patterns:** "It's not X, it's Y." Italicized fragments at the
end of sentences. Em dashes in marketing copy.

Reference: [[Vision]], [[Customers]].`,

  'Q1 Goals.md': `# Q1 Goals (OKRs)

**O1: Validate the founder ICP.**
- KR1: 25 paying users on Pro by week 6
- KR2: 8 customer interviews logged
- KR3: <10% churn on month 1

**O2: Ship Pro features the ICP asks for.**
- KR1: Tone presets shipped
- KR2: Style guide import shipped
- KR3: Slack integration shipped

Plan in [[Launch Plan]]. Pricing in [[Pricing]].`,

  'Founder Notes.md': `# Founder Notes

## Apr 22
Customer discovery call #4 — engineer-founder at a Series A AI infra
company. Said exact words: "I write three investor updates a month and
each one takes me ninety minutes." Pushing on tone presets earlier than
the [[Q1 Goals]] said.

## Apr 23
Pricing pushback from indie hacker cohort — $19/mo too high, $9 felt
right. Need to test [[Pricing]] revision.

## Apr 24
Realized [[Vision]] paragraph 2 is buried. Move it up.`
};

const fileNames = Object.keys(fileContents);
const fileTree: FileNode[] = fileNames.map((name, idx) => ({
  id: `f${idx}`,
  name,
  path: `${ROOT}/${name}`,
  type: 'file',
  extension: 'md',
  size: fileContents[name].length,
  modifiedAt: new Date(2026, 3, 22 + (idx % 5)),
}));

export const linterlyFixture = {
  rootPath: ROOT,
  files: fileTree,
  fileContents,
  shots: {
    workspaceHero: { activeFile: 'Launch Plan.md', backlinksOpen: false, chatPanelOpen: true, chatStreaming: false },
    aiMidStream:   { activeFile: 'Launch Plan.md', chatPanelOpen: true, chatStreaming: true, streamingTarget: 'Brand Voice.md' },
    wikiLinks:     { activeFile: 'Vision.md', backlinksOpen: true },
    templates:     { activeView: 'workflow', activeWorkflow: 'customer-discovery', workflowStep: 4, workflowTotal: 10 },
    multiModel:    { activeView: 'multi-model', prompt: 'Draft a one-paragraph vision statement for Linterly.' },
    apiKeys:       { activeView: 'settings-api-keys' },
    documentSuite: { activeFile: 'Pricing.md', openTabs: ['Pricing.md', 'Q1 Forecast.xlsx', 'Pitch Deck.pptx'] },
  } as const,
  settings: {
    providers: [
      { id: 'anthropic', label: 'Anthropic', keyMasked: 'sk-ant-api03-•••••••••3xQ', defaultModel: 'claude-opus-4-7' },
      { id: 'openai', label: 'OpenAI', keyMasked: 'sk-•••••••••8aB', defaultModel: 'gpt-4o' },
      { id: 'gemini', label: 'Google Gemini', keyMasked: null as string | null, defaultModel: null as string | null },
    ],
    defaultProvider: 'anthropic',
    defaultModel: 'claude-opus-4-7',
  },
  chats: [
    { id: 'chat-1', title: 'Help me write a vision statement', messages: [], createdAt: new Date(2026, 3, 22).toISOString() },
    { id: 'chat-2', title: 'Customer interview script for indie hackers', messages: [], createdAt: new Date(2026, 3, 23).toISOString() },
    { id: 'chat-3', title: 'Pricing tiers for AI grammar tool', messages: [], createdAt: new Date(2026, 3, 24).toISOString() },
  ],
};

export type LinterlyFixture = typeof linterlyFixture;
