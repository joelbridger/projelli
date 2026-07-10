import { describe, expect, it } from 'vitest';
import {
  buildAcatsApprovalAuditMetadata,
  buildSchwabPrepPacketMarkdown,
  exportSchwabPrepPacket,
} from './schwabPrepPacket';
import type { AcatsTransferDraft } from './types';

function field<T>(value: T, confidence = 0.95) {
  return {
    value,
    confidence,
    source: {
      path: 'Clients/Hendricks/statement.pdf',
      page: 1,
      textSnippet: String(value),
      extraction: 'native-pdf' as const,
    },
  };
}

function approvedDraft(): AcatsTransferDraft {
  return {
    id: 'draft-approved',
    matterId: 'matter-1',
    sourceStatementPath: 'Clients/Hendricks/statement.pdf',
    sourceStatementDate: field('2026-03-31'),
    deliveringFirm: {
      name: field('Wells Fargo Advisors'),
      normalizedName: 'wells-fargo-advisors',
    },
    deliveringAccount: {
      accountNumber: field('1234-5678'),
      accountTitle: field('Jamie Daines and Taylor Daines JTWROS'),
      registrationType: field('joint'),
      taxStatus: field('taxable'),
      owners: [field('Jamie Daines'), field('Taylor Daines')],
    },
    receivingSchwabAccount: {
      accountNumber: 'SCH-1111',
      accountType: 'Brokerage',
      registrationType: 'Joint',
    },
    instruction: {
      transferType: 'full',
      residualSweep: true,
    },
    assets: [
      {
        description: field('Apple Inc.'),
        symbol: field('AAPL'),
        cusip: field('037833100'),
        quantity: field('25'),
        marketValue: field('$4,750.00'),
        assetType: field('Equity'),
        action: 'in_kind',
        warnings: [],
      },
    ],
    missingFields: ['Delivering firm phone'],
    warnings: [],
    reviewStatus: 'approved',
  };
}

describe('Schwab Prep Packet export', () => {
  it('builds handoff copy that says Schwab owns signing and submission', () => {
    const markdown = buildSchwabPrepPacketMarkdown(approvedDraft());

    expect(markdown).toContain('Use Schwab');
    expect(markdown).toContain('approved signing and submission path');
    expect(markdown).toContain('Attach the recent delivering-firm statement');
    expect(markdown).toContain('Delivering firm phone');
    expect(markdown.toLowerCase()).not.toContain('lantern submitted');
    expect(markdown.toLowerCase()).not.toContain('submitted the transfer');
  });

  it('masks account numbers in audit metadata', () => {
    expect(buildAcatsApprovalAuditMetadata(approvedDraft())).toMatchObject({
      draftId: 'draft-approved',
      deliveringAccountNumber: '****5678',
      reviewStatus: 'approved',
    });
  });

  it('writes an approved packet as a .docx through the workspace service', async () => {
    const writes = new Map<string, ArrayBuffer>();
    const service = {
      exists: (path: string) => Promise.resolve(writes.has(path)),
      readFileBinary: (path: string) => Promise.resolve(writes.get(path) ?? new ArrayBuffer(0)),
      writeFileBinary: (path: string, content: ArrayBuffer) => {
        writes.set(path, content);
        return Promise.resolve();
      },
      delete: (path: string) => {
        writes.delete(path);
        return Promise.resolve();
      },
    };

    const result = await exportSchwabPrepPacket({
      draft: approvedDraft(),
      workspace: service,
      targetFolder: 'Clients/Hendricks',
    });

    expect(result.name).toBe('Schwab Prep Packet - Wells Fargo Advisors.docx');
    expect(result.path).toBe('Clients/Hendricks/Schwab Prep Packet - Wells Fargo Advisors.docx');
    expect(writes.get(result.path)?.byteLength).toBeGreaterThan(1000);
  });
});
