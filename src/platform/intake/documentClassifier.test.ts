import { describe, expect, it, vi } from 'vitest';

import { classifyIntakeDocument } from './documentClassifier';
import { readIntakeDocument } from './documentReader';
import {
  docSourceRefFromString,
  docSourceRefToString,
  docSourceRefToUi,
} from './documentSourceRef';

const matterFolderPath = '/workspace/Clients/Sarah Household';
const documentPath = `${matterFolderPath}/Requests/onboarding/2025-tax-return.pdf`;

function workspace(bytes = new Uint8Array([1, 2, 3])) {
  return { readFileBinary: vi.fn().mockResolvedValue(bytes.buffer) };
}

describe('advisor-side intake document reader and classifier', () => {
  it('reads native PDF pages and creates page-indexed tax-return source refs', async () => {
    const service = workspace();
    const readResult = await readIntakeDocument({
      path: documentPath,
      matterFolderPath,
      workspaceService: service,
      dependencies: {
        extractPdfText: vi.fn().mockResolvedValue({
          encrypted: false,
          scanned: false,
          pageCount: 2,
          pages: [
            'Form 1040. Adjusted gross income for the household.',
            'Schedule 1 and taxable income are listed here.',
          ],
        }),
      },
    });

    expect(readResult).toEqual({
      status: 'read',
      pages: [
        expect.objectContaining({ page: 1, extraction: 'text' }),
        expect.objectContaining({ page: 2, extraction: 'text' }),
      ],
    });
    const classification = classifyIntakeDocument({
      path: documentPath,
      filename: '2025-tax-return.pdf',
      readResult,
    });
    expect(classification).toMatchObject({ kind: 'tax_return', confidence: 'high' });
    expect(classification.sourceRefs).toEqual([
      expect.objectContaining({ path: documentPath, page: 1, extraction: 'text' }),
      expect.objectContaining({ path: documentPath, page: 2, extraction: 'text' }),
    ]);
  });

  it('keeps local OCR source refs and their confidence for a scanned PDF', async () => {
    const renderPdfPageToPng = vi.fn().mockResolvedValue(new Uint8Array([9]));
    const ocrPageImage = vi.fn()
      .mockResolvedValueOnce({ text: 'Pay period Gross pay Net pay', confidence: 87 })
      .mockResolvedValueOnce({ text: 'YTD earnings and deductions', confidence: 83 });
    const readResult = await readIntakeDocument({
      path: `${matterFolderPath}/Requests/onboarding/pay-stub.pdf`,
      matterFolderPath,
      workspaceService: workspace(),
      dependencies: {
        extractPdfText: vi.fn().mockResolvedValue({ encrypted: false, scanned: true, pageCount: 2, pages: ['', ''] }),
        renderPdfPageToPng,
        isOcrEngineAvailable: () => true,
        ocrPageImage,
        destroyOcrClient: vi.fn().mockResolvedValue(undefined),
      },
    });
    const classification = classifyIntakeDocument({
      path: `${matterFolderPath}/Requests/onboarding/pay-stub.pdf`,
      filename: 'pay-stub.pdf',
      readResult,
    });

    expect(renderPdfPageToPng).toHaveBeenCalledTimes(2);
    expect(ocrPageImage).toHaveBeenCalledTimes(2);
    expect(classification).toMatchObject({ kind: 'pay_stub', confidence: 'medium' });
    expect(classification.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 1, extraction: 'ocr', confidence: 87 }),
      expect.objectContaining({ page: 2, extraction: 'ocr', confidence: 83 }),
    ]));
  });

  it('surfaces low-confidence OCR as low trust', () => {
    const classification = classifyIntakeDocument({
      path: `${matterFolderPath}/Requests/onboarding/noisy-pay-stub.pdf`,
      filename: 'noisy-pay-stub.pdf',
      readResult: {
        status: 'read',
        pages: [{ page: 1, text: 'Pay period gross pay net pay', extraction: 'ocr', confidence: 42 }],
      },
    });

    expect(classification).toMatchObject({ kind: 'pay_stub', confidence: 'low' });
    expect(classification.confidence).not.toBe('high');
    expect(classification.sourceRefs[0]).toMatchObject({ extraction: 'ocr', confidence: 42 });
  });

  it('classifies an unknown document without fact-bearing output', () => {
    const classification = classifyIntakeDocument({
      path: `${matterFolderPath}/Requests/onboarding/family-photo.jpg`,
      filename: 'family-photo.jpg',
      readResult: {
        status: 'read',
        pages: [{ page: 1, text: 'A sunny afternoon at the park.', extraction: 'ocr', confidence: 92 }],
      },
    });

    expect(classification).toEqual({
      kind: 'unknown',
      confidence: 'low',
      sourceRefs: [],
      evidence: [],
    });
  });

  it('refuses traversal and absolute escapes before reading bytes', async () => {
    const service = workspace();
    await expect(readIntakeDocument({
      path: `${matterFolderPath}/Requests/onboarding/../outside.pdf`,
      matterFolderPath,
      workspaceService: service,
    })).rejects.toThrow(/stay inside the client folder/iu);
    await expect(readIntakeDocument({
      path: '/workspace/Other Household/tax-return.pdf',
      matterFolderPath,
      workspaceService: service,
    })).rejects.toThrow(/stay inside the client folder/iu);
    expect(service.readFileBinary).not.toHaveBeenCalled();
  });

  it('round-trips compact source locations and formats a Client Map source', () => {
    const source = {
      kind: 'document' as const,
      path: documentPath,
      page: 2,
      snippet: 'Adjusted gross income appears on this page.',
      extraction: 'text' as const,
    };
    const compact = docSourceRefToString(source);
    expect(compact).toBe(`document:${documentPath}#page=2`);
    expect(docSourceRefFromString(compact)).toEqual({
      kind: 'document', path: documentPath, page: 2, snippet: '',
    });
    expect(docSourceRefToUi(source)).toEqual({
      kind: 'document',
      ref: documentPath,
      locator: 'p. 2',
      snippet: 'Adjusted gross income appears on this page.',
    });
  });
});
