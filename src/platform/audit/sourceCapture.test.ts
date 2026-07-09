import { describe, expect, it } from 'vitest';
import type { AuditSourceIdentity } from '@/platform/types/audit';
import { formatSourceCountSummary } from './sourceCapture';

describe('sourceCapture receipts', () => {
  it('summarizes all source kinds instead of only emails and PDFs', () => {
    const sources: AuditSourceIdentity[] = [
      { id: 'doc-1', label: 'profile.docx', path: 'clients/profile.docx', sourceType: 'docx', chunkCount: 1 },
      { id: 'doc-2', label: 'estate.docx', path: 'clients/estate.docx', sourceType: 'docx', chunkCount: 1 },
      { id: 'crm-1', label: 'Wealthbox household', path: 'crm:wealthbox:1', sourceType: 'crm', chunkCount: 1 },
      { id: 'tr-1', label: 'Annual review transcript', path: 'meeting:1', sourceType: 'transcript', chunkCount: 1 },
    ];

    expect(formatSourceCountSummary(sources)).toBe(
      '4 sources (2 Word documents, 1 CRM record)',
    );
  });
});
