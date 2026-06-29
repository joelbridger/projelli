/*
 * marketing-demo/data/webbSeed.mjs
 * DEMO-ONLY seed for the marketing video. Builds the two localStorage envelopes
 * (keepance:matters v7, keepance:client-maps v2) that make the REAL Client Map
 * panel render fully-populated for the Webb Household, using the canonical Webb
 * demo data (src/web-demo/sample-workspace-advisor.json). Written before app
 * load by the Playwright director. Nothing here ships in the product.
 */

export const MATTER_ID = 'matter_webb_household';
const NOW = '2026-06-28T12:00:00.000Z';
const F = '/keepance-demo/Webb Household';

const src = (file, snippet, locator) => ({
  kind: 'document', ref: `${F}/${file}`, snippet, ...(locator ? { locator } : {}),
});
const item = (id, text, sources, isAssumption = false) => ({
  id, text, origin: 'ai', isAssumption, sources, updatedAt: NOW,
});

export const mattersEnvelope = {
  state: {
    matters: [{
      id: MATTER_ID,
      name: 'Webb Household',
      client: 'Webb Household',
      folderPaths: [F],
      mailFolderPaths: [], crmHouseholdKeys: [], onedriveFolderKeys: [],
      esignKeys: [], meetingKeys: [],
      privileged: false, mcpAccessGranted: false,
      createdAt: NOW,
    }],
    activeMatterId: MATTER_ID,
  },
  version: 7,
};

const map = {
  matterId: MATTER_ID,
  sections: [
    { id: 'story', kind: 'core', key: 'story', title: 'The story so far', items: [
      item('s1', 'Comprehensive financial planning and ongoing investment management for the Webb household; engagement opened Sept 4, 2025.',
        [src('Client Intake Summary.md', 'Engagement: Comprehensive financial planning + ongoing investment management. Date opened: 2025-09-04')]),
      item('s2', 'Goals: retire at 60, fund both kids’ college, and pay off the house early.',
        [src('Financial Plan Summary.md', "Goals: Retire at 60, fund both kids' college, pay off the house early")]),
    ]},
    { id: 'people', kind: 'core', key: 'people', title: 'Key people', items: [
      item('p1', 'Marcus Webb (38) and Tanya Webb (37), married.',
        [src('Financial Plan Summary.md', 'Clients: Marcus Webb (38) and Tanya Webb (37)')]),
      item('p2', 'Two minor children: Caleb (8) and Ava (5).',
        [src('Financial Plan Summary.md', 'Dependents: Caleb (8), Ava (5)')]),
      item('p3', 'Jessica Reyes, Marcus’s first wife (divorced 2019); still listed on an old account.',
        [src('Beneficiary Designations.md', "The old 401(k) still lists Jessica Reyes, Marcus's first wife, as the sole primary beneficiary, dated 2019.")]),
    ]},
    { id: 'standing', kind: 'core', key: 'standing', title: 'Where things stand', items: [
      item('a1', 'Marcus 401(k): $412,000 (12% contribution + 4% match).', [src('Financial Plan Summary.md', 'Marcus 401(k): $412,000, contributing 12% plus a 4% match.')]),
      item('a2', 'Old employer 401(k): $96,000, still at the prior custodian; rollover pending.', [src('Financial Plan Summary.md', 'Old employer 401(k) of $96,000 still sitting at the prior custodian, not yet rolled over.')]),
      item('a3', 'Tanya 403(b): $188,000 (9% contribution).', [src('Financial Plan Summary.md', 'Tanya 403(b): $188,000, contributing 9%.')]),
      item('a4', 'Joint brokerage: $145,000, mostly index funds.', [src('Financial Plan Summary.md', 'Joint brokerage: $145,000, mostly index funds.')]),
      item('a5', 'Roth IRAs: $61,000 (Marcus), $54,000 (Tanya).', [src('Financial Plan Summary.md', 'Roth IRAs: $61,000 (Marcus), $54,000 (Tanya).')]),
      item('a6', '529 plans: $48,000 (Caleb), $29,000 (Ava).', [src('Financial Plan Summary.md', '529 plans: $48,000 (Caleb), $29,000 (Ava).')]),
      item('a7', '⚠ Stale beneficiary: the old 401(k) still names ex-wife Jessica Reyes (100%), dated 2019; it would pass to her, not Tanya.',
        [src('Beneficiary Designations.md', 'Old 401(k) (prior employer) | Marcus | Jessica Reyes (100%) | none listed | 2019')]),
    ]},
    { id: 'upcoming', kind: 'core', key: 'upcoming', title: "What's coming", items: [
      item('u1', 'Roll the old 401(k) into Marcus’s IRA; paperwork pending.', [src('Review Notes.md', "Roll the old 401(k) into Marcus's IRA. I'll start the paperwork.")]),
      item('u2', 'Decide the Roth conversion amount before year-end.', [src('Financial Plan Summary.md', 'Decide on the Roth conversion amount before year-end.')]),
      item('u3', 'Increase joint brokerage auto-contribution by $400/month (Tanya’s raise).', [src('Review Notes.md', 'Increase the joint brokerage auto-contribution by $400/month.')]),
    ]},
    { id: 'next', kind: 'core', key: 'next', title: 'Next actions', items: [
      item('n1', 'Start the rollover paperwork and confirm the receiving account.', [src('Financial Plan Summary.md', 'Confirm the rollover paperwork and the receiving account.')]),
      item('n2', 'Recheck every beneficiary designation against the custodian, not the client’s memory.', [src('Review Notes.md', 'Recheck every beneficiary designation. Marcus’s comment about the divorce is exactly why.')]),
    ]},
  ],
  completeness: {
    level: 'solid',
    know: [],
    assuming: [],
    ask: [
      { text: 'Confirm the old 401(k) beneficiary with the custodian; it still lists ex-wife Jessica Reyes, not Tanya.', sectionKey: 'standing' },
      { text: 'Confirm current contribution rates after Tanya’s raise.', sectionKey: 'standing' },
    ],
  },
  pendingUpdates: [],
  lastBuiltAt: '',
  lastSourceFingerprint: '',
};

export const clientMapsEnvelope = {
  state: { maps: { [MATTER_ID]: map }, clientQuestions: {} },
  version: 2,
};
