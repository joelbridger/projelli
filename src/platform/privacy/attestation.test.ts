import { describe, it, expect } from 'vitest';
import { buildAttestationMarkdown } from './attestation';

const input = {
  workspaceName: 'Henderson Practice',
  generatedAt: '2026-07-02T12:00:00.000Z',
  policyLabel: 'Delete audio after 30 days, keep the transcript',
  integrityLine: 'Audit log integrity: verified (128 entries checked)',
  consent: [
    { client: 'Sarah Henderson', confirmedAt: '2026-06-12T10:00:00Z', mode: 'one-party', scope: 'standing', note: 'email 6/12' },
  ],
  recordings: [
    { timestamp: '2026-06-14T15:00:00Z', description: 'Meeting recorded: 2026-06-14-annual-review (consent: one-party)' },
  ],
  deletions: [
    { timestamp: '2026-07-01T03:00:00Z', description: 'Retention policy removed audio: .../audio.wav' },
  ],
};

describe('buildAttestationMarkdown', () => {
  it('renders all four sections with tables', () => {
    const md = buildAttestationMarkdown(input);
    expect(md).toContain('# Recording and Retention Attestation');
    expect(md).toContain('Henderson Practice');
    expect(md).toContain('| Sarah Henderson | 2026-06-12T10:00:00Z | one-party | standing | email 6/12 |');
    expect(md).toContain('Meeting recorded: 2026-06-14-annual-review');
    expect(md).toContain('Retention policy removed audio');
    expect(md).toContain('Audit log integrity: verified');
  });
  it('handles empty sections and never emits em dashes', () => {
    const md = buildAttestationMarkdown({ ...input, consent: [], recordings: [], deletions: [] });
    expect(md).toContain('No consent events recorded.');
    expect(md).toContain('No recordings logged.');
    expect(md).toContain('No deletions logged.');
    expect(md.includes('—')).toBe(false);
  });
});
