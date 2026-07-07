import { describe, it, expect, beforeEach } from 'vitest';
import { emptyClientMap } from '@/platform/clientMap/types';
import { clientMapToMarkdown, suggestClientMapExportName } from '@/features/matters/clientMap/exportClientMap';
import { useProfileStore } from '@/platform/profile/profileStore';

describe('clientMap export', () => {
  beforeEach(() => {
    useProfileStore.setState({ firmName: 'Northcrest Wealth', soloName: '' });
  });

  it('renders a branded sourced map with edit history', () => {
    const map = emptyClientMap('m1');
    map.sections[0]!.items.push({
      id: 'i1',
      text: 'Robert and Susan are retired.',
      origin: 'ai',
      isAssumption: false,
      sources: [{ kind: 'document', ref: '/Clients/Hendricks/Plan.docx', snippet: 'retired', locator: 'p. 2' }],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    map.editHistory = [{
      id: 'h1',
      action: 'bullet_edited',
      actor: 'Casey Advisor',
      timestamp: '2026-07-07T01:02:03.000Z',
      sectionId: 'household',
      sectionKey: 'household',
      sectionTitle: 'Household',
      itemId: 'i1',
      beforeText: 'Robert retired.',
      afterText: 'Robert and Susan are retired.',
      sources: [{ kind: 'document', ref: '/Clients/Hendricks/Plan.docx', snippet: 'retired', locator: 'p. 2' }],
    }];

    const markdown = clientMapToMarkdown(map, 'Hendricks Household', new Date('2026-07-07T02:00:00.000Z'));

    expect(markdown).toContain('# Advisor Prep Hero Client Map: Hendricks Household');
    expect(markdown).toContain('Prepared for Northcrest Wealth');
    expect(markdown).toContain('- Robert and Susan are retired. Source: document: Plan.docx, p. 2.');
    expect(markdown).toContain('Casey Advisor - bullet edited - Household.');
    expect(markdown).toContain('Source: document: Plan.docx, p. 2.');
  });

  it('suggests a safe Word filename', () => {
    expect(suggestClientMapExportName('Robert & Susan / Hendricks Household')).toBe(
      'Robert-Susan-Hendricks-Household-Client-Map.docx',
    );
  });
});
