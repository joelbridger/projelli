import { describe, expect, it } from 'vitest';

import { classifyTier1 } from '@/platform/intake/documentDetectiveRules';
import type { Tier1ClassifyInput } from '@/platform/intake/documentDetectiveTypes';

function classify(overrides: Partial<Tier1ClassifyInput> = {}) {
  return classifyTier1({
    item: { item_id: 'license', label: "Driver's license" },
    slotIndex: 0,
    slotRole: 'front',
    file: { name: 'document.txt', mimeType: 'text/plain', byteSize: 100, textSample: '' },
    ...overrides,
  });
}

describe('classifyTier1', () => {
  it('warns when a tax return is selected for a license item', () => {
    const result = classify({
      file: { name: 'return.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'Form 1040 adjusted gross income' },
    });

    expect(result).toMatchObject({
      verdict: 'warn',
      reason: 'wrong_doc',
      expected: { kind: 'drivers_license' },
      observed: 'tax_return',
    });
  });

  it('warns when a pay stub is selected for a license item', () => {
    const result = classify({
      file: { name: 'pay.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'Pay period gross pay net pay' },
    });

    expect(result).toMatchObject({ verdict: 'warn', reason: 'wrong_doc', observed: 'pay_stub' });
  });

  it('warns when back-side signals are selected for the license front slot', () => {
    const result = classify({
      file: { name: 'back.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'PDF417 AAMVA DAQ barcode' },
    });

    expect(result).toMatchObject({ verdict: 'warn', reason: 'wrong_side_of_license', side: 'back' });
  });

  it('warns when both license slots identify as the front', () => {
    const first = classify({
      file: { name: 'front.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'Driver license class restrictions' },
    });
    expect(first).toMatchObject({ verdict: 'ok', side: 'front' });

    const second = classify({
      slotIndex: 1,
      slotRole: 'back',
      siblingLicenseSide: 'front',
      file: { name: 'front-again.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'Driver license class restrictions' },
    });
    expect(second).toMatchObject({ verdict: 'warn', reason: 'duplicate_license_side', side: 'front' });
  });

  it('accepts a pay stub for an income-support item', () => {
    const result = classify({
      item: {
        item_id: 'income_support',
        label: 'Income support',
        expected_doc_types: ['pay_stub', 'tax_return'],
      },
      slotRole: 'file',
      file: { name: 'pay.txt', mimeType: 'text/plain', byteSize: 100, textSample: 'Pay period gross pay net pay' },
    });

    expect(result).toMatchObject({ verdict: 'ok', observed: 'pay_stub' });
  });

  it('returns unknown for an image with no readable text', () => {
    const result = classify({
      file: { name: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 100, textSample: '' },
    });

    expect(result).toEqual({ verdict: 'unknown', evidence: [] });
  });

  it('does not warn from a filename alone', () => {
    const result = classify({
      file: { name: 'tax.pdf', mimeType: 'application/pdf', byteSize: 100, textSample: '' },
    });

    expect(result.verdict).not.toBe('warn');
  });

  it('prefers an IRA statement over a brokerage statement when both are signaled', () => {
    const result = classify({
      item: { item_id: 'statement', label: 'Brokerage statement' },
      slotRole: 'file',
      file: {
        name: 'statement.txt',
        mimeType: 'text/plain',
        byteSize: 100,
        textSample: 'Traditional IRA portfolio value holdings brokerage statement',
      },
    });

    expect(result).toMatchObject({ verdict: 'warn', reason: 'wrong_doc', observed: 'ira_statement' });
  });
});
