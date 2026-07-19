import { describe, expect, it } from 'vitest';
import panelSource from './MeetingFollowUpPanel.tsx?raw';
import editorSource from './FollowUpDraftsOnlyEditor.tsx?raw';
import adapterSource from './followUpDraftsOnlyAdapter.ts?raw';
import storeSource from './meetingFollowUpStore.ts?raw';

const followUpProductionGraph = [
  ['MeetingFollowUpPanel.tsx', panelSource],
  ['FollowUpDraftsOnlyEditor.tsx', editorSource],
  ['followUpDraftsOnlyAdapter.ts', adapterSource],
  ['meetingFollowUpStore.ts', storeSource],
] as const;

const forbiddenEgressSymbols = [
  ['mail', 'Send'].join(''),
  ['sendPreparedStructuredWithEgress', 'Audit'].join(''),
] as const;

describe('meeting follow-up Drafts-only static egress boundary', () => {
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
});
