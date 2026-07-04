import '@/i18n';
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { composeCrmProvenance } from '@/features/matters/crmProvenance';

const t = i18next.t.bind(i18next);

describe('composeCrmProvenance (E3 — AI-drafted CRM notes carry their origin)', () => {
  it('names the AI author, the meeting date, the advisor, and the approval date', () => {
    const line = composeCrmProvenance(
      t,
      { advisor: 'Dana Lee', sourceKind: 'meeting', sourceDate: '2026-07-02T00:00:00Z', approvedIso: '2026-07-04T00:00:00Z' },
      'en-US',
    );
    expect(line).toContain('Advisor Prep Hero AI');
    expect(line).toContain('Dana Lee');
    expect(line).toContain('7/2/2026'); // meeting date, en-US
    expect(line).toContain('7/4/2026'); // approval date, en-US
    expect(line.toLowerCase()).toContain('meeting');
  });

  it('uses the no-source template for a document draft', () => {
    const line = composeCrmProvenance(
      t,
      { advisor: 'Dana Lee', sourceKind: 'document', approvedIso: '2026-07-04T00:00:00Z' },
      'en-US',
    );
    expect(line).toContain('Advisor Prep Hero AI');
    expect(line).toContain('Dana Lee');
    expect(line.toLowerCase()).not.toContain('meeting');
  });

  it('falls back to a generic advisor when no name is set', () => {
    const line = composeCrmProvenance(
      t,
      { advisor: '  ', sourceKind: 'meeting', sourceDate: '2026-07-02T00:00:00Z', approvedIso: '2026-07-04T00:00:00Z' },
      'en-US',
    );
    expect(line).toContain('the advisor');
  });
});
