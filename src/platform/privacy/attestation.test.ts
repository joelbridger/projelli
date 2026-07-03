import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildAttestationMarkdown } from './attestation';
import { markdownToDocxBytes } from '@/platform/utils/docx-io';

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

  // VERIFY-LIVE (Task 17): exercises the real in-house OOXML engine end to
  // end on the actual attestation shape (title, bold metadata lines, three
  // tables), not just the pure markdown string — the risky part of this
  // feature is the custom .docx serialization, not the markdown builder,
  // which the tests above already cover.
  it('produces a real, valid .docx with the title, policy line, integrity line, and all three tables', async () => {
    const md = buildAttestationMarkdown(input);
    const bytes = await markdownToDocxBytes(md, 'Attestation Report 2026-07-02.docx');
    expect(bytes.byteLength).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    const documentXml = await zip.file('word/document.xml')?.async('text');
    expect(documentXml).toBeTruthy();
    const doc = documentXml ?? '';
    expect(doc).toContain('Recording and Retention Attestation');
    expect(doc).toContain('Henderson Practice');
    expect(doc).toContain('Delete audio after 30 days, keep the transcript');
    expect(doc).toContain('Audit log integrity: verified (128 entries checked)');
    expect(doc).toContain('Sarah Henderson');
    expect(doc).toContain('Meeting recorded: 2026-06-14-annual-review');
    expect(doc).toContain('Retention policy removed audio');
    // Three sections rendered as real WordprocessingML tables (<w:tbl>), one
    // per non-empty section (Consent on file, Recordings, Deletions).
    expect((doc.match(/<w:tbl>/g) ?? []).length).toBe(3);
  });
});
