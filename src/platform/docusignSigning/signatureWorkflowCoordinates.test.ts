import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { resolveDocusignTabMap } from './signatureWorkflow';

const map = {
  signatureTab: { page: 1, rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.1 } },
  dateSignedTab: { page: 2, rect: { x: 0.5, y: 0.25, width: 0.1, height: 0.2 } },
  signerNameTab: { page: 2, rect: { x: 0.2, y: 0.5, width: 0.3, height: 0.1 } },
};

describe('DocuSign page-point tab resolution', () => {
  it('uses each reviewed page’s real dimensions, with Y measured down from the top', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]); // US Letter points
    pdf.addPage([1000, 500]); // intentionally non-Letter
    const resolved = await resolveDocusignTabMap(await pdf.save(), map);
    expect(resolved.signatureTab).toEqual({ page: 1, xPosition: 61, yPosition: 158, width: 153, height: 79 });
    expect(resolved.dateSignedTab).toEqual({ page: 2, xPosition: 500, yPosition: 125, width: 100, height: 100 });
    expect(resolved.signerNameTab).toEqual({ page: 2, xPosition: 200, yPosition: 250, width: 300, height: 50 });
  });
});
