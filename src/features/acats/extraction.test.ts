import { describe, expect, it, vi } from 'vitest';
import {
  ACATS_MULTIPLE_ACCOUNT_NUMBERS_WARNING,
  buildAcatsDraftWarnings,
  classifyAcatsStatementPages,
  extractAcatsDraftFromPdfBytes,
  extractAcatsDraftFromTextPages,
} from './extraction';

const NOW = new Date('2026-07-10T12:00:00Z');

const cleanNativeStatement = `
Wells Fargo Advisors
Brokerage Account Statement
Statement Period: January 1, 2026 - March 31, 2026
Account Number: 1234-5678
Account Title: Jamie Daines and Taylor Daines JTWROS
Account Type: Joint Brokerage

Holdings
Symbol | CUSIP | Description | Quantity | Market Value | Asset Type
AAPL | 037833100 | Apple Inc. | 25 | $4,750.00 | Equity
VTSAX | 922908728 | Vanguard Total Stock Market Index Fund | 10.25 | $1,260.00 | Mutual Fund
`;

const ocrStatement = `
Fidelity Investments
Brokerage Account Statement
Statement Date: May 31, 2026
Account Number: Z12345678
Account Title: Jamie Daines Roth IRA
Account Type: Roth IRA

Positions
Symbol | CUSIP | Description | Quantity | Market Value | Asset Type
FXAIX | 315911750 | Fidelity 500 Index Fund | 18.5 | $3,210.44 | Mutual Fund
`;

const maskedStatement = `
Morgan Stanley
Client Statement
Statement Date: April 30, 2026
Account Number: ****7890
Account Title: Jamie Daines Revocable Trust
Account Type: Trust Brokerage

Holdings
Symbol | CUSIP | Description | Quantity | Market Value | Asset Type
WFPRX | 94975P868 | Wells Fargo Proprietary Growth Fund | 12 | $404.00 | Mutual Fund
`;

describe('ACATS statement extraction', () => {
  it('classifies brokerage statements and rejects non-brokerage documents', () => {
    const brokerage = classifyAcatsStatementPages({
      sourcePath: 'Clients/Hendricks/wells-statement.pdf',
      pages: [{ pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' }],
    });
    expect(brokerage.looksLikeBrokerageStatement).toBe(true);
    expect(brokerage.deliveringFirm?.value).toBe('Wells Fargo Advisors');
    expect(brokerage.normalizedFirmName).toBe('wells-fargo-advisors');
    expect(brokerage.statementDate?.value).toBe('2026-03-31');

    const bank = classifyAcatsStatementPages({
      sourcePath: 'Clients/Hendricks/checking.pdf',
      pages: [
        {
          pageNumber: 1,
          text: 'Monthly Checking Account Bank Statement Deposits Withdrawals FDIC',
          extraction: 'native-pdf',
        },
      ],
    });
    expect(bank.looksLikeBrokerageStatement).toBe(false);
  });

  it('extracts the account number from an "Account #:" line (codex-review, 2026-07-10)', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-hash-format',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/statement.pdf',
      pages: [
        {
          pageNumber: 1,
          text: 'Wells Fargo Advisors\nAccount #: 5551234\nAccount Title: Jamie Daines',
          extraction: 'native-pdf',
        },
      ],
      now: NOW,
    });

    expect(draft.deliveringAccount.accountNumber?.value).toBe('5551234');
  });

  it('does not swallow the next label when PDF text is flattened onto one line (codex-review, 2026-07-10)', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-flattened',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/statement.pdf',
      pages: [
        {
          pageNumber: 1,
          text: 'Wells Fargo Advisors Account Number: 1234 Account Title: Jamie Daines',
          extraction: 'native-pdf',
        },
      ],
      now: NOW,
    });

    expect(draft.deliveringAccount.accountNumber?.value).toBe('1234');
  });

  it('lowers confidence and warns when a statement has two different account numbers', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-multiple-accounts',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/household-statement.pdf',
      pages: [
        { pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' },
        {
          pageNumber: 2,
          text: 'Account Number: 9999-0000\nAccount Title: Jamie Daines IRA\nHoldings',
          extraction: 'native-pdf',
        },
      ],
      now: NOW,
    });

    expect(draft.deliveringAccount.accountNumber?.value).toBe('1234-5678');
    expect(draft.deliveringAccount.accountNumber?.confidence).toBeLessThan(0.7);
    expect(draft.warnings).toContain(ACATS_MULTIPLE_ACCOUNT_NUMBERS_WARNING);
  });

  it('does not warn when the same account number is printed more than once', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-repeated-account',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/repeated-statement.pdf',
      pages: [
        { pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' },
        {
          pageNumber: 2,
          text: 'Account No. 12345678\nAccount Title: Jamie Daines and Taylor Daines JTWROS',
          extraction: 'native-pdf',
        },
      ],
      now: NOW,
    });

    expect(draft.deliveringAccount.accountNumber?.confidence).toBe(0.93);
    expect(draft.warnings).not.toContain(ACATS_MULTIPLE_ACCOUNT_NUMBERS_WARNING);
  });

  it('extracts a clean native-PDF brokerage statement with page citations', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-clean',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/wells-statement.pdf',
      pages: [{ pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' }],
      now: NOW,
    });

    expect(draft.deliveringFirm.name?.value).toBe('Wells Fargo Advisors');
    expect(draft.deliveringFirm.normalizedName).toBe('wells-fargo-advisors');
    expect(draft.sourceStatementDate?.value).toBe('2026-03-31');
    expect(draft.deliveringAccount.accountNumber?.value).toBe('1234-5678');
    expect(draft.deliveringAccount.registrationType?.value).toBe('joint');
    expect(draft.deliveringAccount.taxStatus?.value).toBe('taxable');
    expect(draft.assets).toHaveLength(2);
    expect(draft.assets[0]?.symbol?.value).toBe('AAPL');
    expect(draft.assets[0]?.cusip?.value).toBe('037833100');
    expect(draft.assets[0]?.description.source).toMatchObject({
      path: 'Clients/Hendricks/wells-statement.pdf',
      page: 1,
      extraction: 'native-pdf',
    });
    expect(draft.missingFields).toContain('Transfer type');
    expect(draft.reviewStatus).toBe('needs_review');
  });

  it('uses the OCR seam for scanned pages and keeps low-confidence fields under review', async () => {
    const destroyOcr = vi.fn(() => Promise.resolve());
    const draft = await extractAcatsDraftFromPdfBytes(new Uint8Array([1, 2, 3]), {
      id: 'draft-ocr',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/fidelity-scan.pdf',
      now: NOW,
      pdfTextExtractor: vi.fn(() => Promise.resolve({
        pages: [''],
        pageCount: 1,
        encrypted: false,
        scanned: true,
      })),
      renderPageToPng: vi.fn(() => Promise.resolve(new Uint8Array([9]))),
      ocrPage: vi.fn(() => Promise.resolve({ text: ocrStatement, confidence: 52 })),
      destroyOcr,
    });

    expect(draft.deliveringFirm.name?.value).toBe('Fidelity Investments');
    expect(draft.deliveringFirm.name?.source.extraction).toBe('ocr');
    expect(draft.deliveringFirm.name?.confidence).toBeLessThan(0.8);
    expect(draft.assets[0]?.description.source.extraction).toBe('ocr');
    expect(draft.warnings).toContain('Low OCR confidence on a critical field');
    expect(destroyOcr).toHaveBeenCalledTimes(1);
    expect(draft.reviewStatus).toBe('needs_review');
  });

  it('marks masked account numbers as blocked instead of auto-approved', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-masked',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/morgan-stanley.pdf',
      pages: [{ pageNumber: 1, text: maskedStatement, extraction: 'native-pdf' }],
      now: NOW,
    });

    expect(draft.deliveringAccount.accountNumber?.value).toBe('****7890');
    expect(draft.deliveringAccount.accountNumber?.confidence).toBeLessThan(0.7);
    expect(draft.missingFields).toContain('Unmasked delivering account number');
    expect(draft.warnings).toContain('Account number is masked');
    expect(draft.warnings).toContain('Likely proprietary fund or non-ACATS asset');
  });

  it('warns when delivering and receiving registration do not match', () => {
    const draft = extractAcatsDraftFromTextPages({
      id: 'draft-title-mismatch',
      matterId: 'matter-1',
      sourcePath: 'Clients/Hendricks/wells-statement.pdf',
      pages: [{ pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' }],
      now: NOW,
    });

    const warnings = buildAcatsDraftWarnings(
      {
        ...draft,
        receivingSchwabAccount: {
          accountType: 'Brokerage',
          registrationType: 'Individual',
        },
      },
      [{ pageNumber: 1, text: cleanNativeStatement, extraction: 'native-pdf' }],
      NOW,
    );

    expect(warnings).toContain('Account title does not match the receiving Schwab account title');
  });
});
