import { beforeEach, describe, expect, it, vi } from 'vitest';
import panelSource from './MeetingFollowUpPanel.tsx?raw';
import editorSource from './FollowUpDraftsOnlyEditor.tsx?raw';
import adapterSource from './followUpDraftsOnlyAdapter.ts?raw';
import storeSource from './meetingFollowUpStore.ts?raw';
import liveRecordsSource from '@/platform/crm/liveRecords.ts?raw';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
const globalWorkspace = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: native.invoke,
}));

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: globalWorkspace.set,
}));

const followUpProductionGraph = [
  ['MeetingFollowUpPanel.tsx', panelSource],
  ['FollowUpDraftsOnlyEditor.tsx', editorSource],
  ['followUpDraftsOnlyAdapter.ts', adapterSource],
  ['meetingFollowUpStore.ts', storeSource],
] as const;

const forbiddenEgressSymbols = [
  ['mail', 'Send'].join(''),
  ['mail_', 'send'].join(''),
  ['mail_', 'send_existing_draft'].join(''),
  ['sendPreparedStructuredWithEgress', 'Audit'].join(''),
] as const;

describe('meeting follow-up Drafts-only static egress boundary', () => {
  beforeEach(() => {
    native.invoke.mockReset();
    globalWorkspace.set.mockReset();
  });
  it('keeps delivery and AI-content egress absent from the whole production path', () => {
    expect(panelSource).toContain("from './FollowUpDraftsOnlyEditor'");

    for (const [file, source] of followUpProductionGraph) {
      expect(
        source,
        `${file} must not import the shared email feature`
      ).not.toContain("from '@/features/email'");
      expect(
        source,
        `${file} must not reach the shared mail modal`
      ).not.toContain('DraftFollowUpModal');
      for (const symbol of forbiddenEgressSymbols) {
        expect(source, `${file} must not reference ${symbol}`).not.toContain(
          symbol
        );
      }
    }
  });

  it('grants the adapter only account discovery and draft creation', () => {
    const commandImport = adapterSource.match(
      /import\s*\{([\s\S]*?)\}\s*from '@\/platform\/utils\/mail-commands';/
    );
    expect(commandImport).not.toBeNull();
    const importedNames = (commandImport?.[1] ?? '')
      .split(',')
      .map((name) => name.replace(/^\s*type\s+/, '').trim())
      .filter(Boolean)
      .sort();
    expect(importedNames).toEqual(
      ['ConnectedAccount', 'mailConnectedAccounts', 'mailSaveDraft'].sort()
    );
    expect(adapterSource).toContain('return mailSaveDraft(');
  });

  it('has no unsafe exact-draft opening claim when the public result is only an id', () => {
    expect(adapterSource).toContain('returns only an opaque provider id');
    expect(adapterSource).toContain('providerDraftsUrl');
    expect(editorSource).toContain('That folder is open');
    expect(editorSource).not.toContain('exact draft was opened');
  });

  it('pins each native claim to its requested workspace instead of switching global state first', () => {
    const claimFunction = liveRecordsSource.slice(
      liveRecordsSource.indexOf('export async function claimProviderFollowUpDraft'),
      liveRecordsSource.indexOf('/**\n * Atomic load/rebase/upsert')
    );
    expect(claimFunction).toContain('{ workspaceRoot, claim }');
    expect(claimFunction).not.toContain('inCrmWorkspace(');
    expect(claimFunction).not.toContain('crmSetWorkspace(');
  });

  it('keeps a claim in its intended database when another panel changes the global workspace first', async () => {
    const { claimProviderFollowUpDraft } = await import(
      '@/platform/crm/liveRecords'
    );
    globalWorkspace.set.mockResolvedValue(undefined);
    native.invoke.mockResolvedValue({ outcome: 'acquired' });

    // This represents another panel selecting its own workspace after this
    // panel chose /workspace-a but before it begins its claim.
    await globalWorkspace.set('/workspace-b');
    await expect(
      claimProviderFollowUpDraft('/workspace-a', {
        recapKey: `meeting-follow-up-${'a'.repeat(64)}`,
        artifactId: 'follow-up-a',
        meetingId: 'meeting-a',
        householdRef: 'household-a',
        matterId: 'matter-a',
        to: 'client@example.test',
        subject: 'Review recap',
        body: 'Thank you for meeting today.',
        provider: 'm365',
        account: 'advisor@firm.test',
        accountLabel: 'Advisor Outlook',
      })
    ).resolves.toEqual({ outcome: 'acquired' });

    expect(globalWorkspace.set).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith(
      'crm_claim_provider_follow_up_draft',
      expect.objectContaining({ workspaceRoot: '/workspace-a' })
    );
  });
});
