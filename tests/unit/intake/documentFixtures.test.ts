import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { classifyIntakeDocument } from '@/platform/intake/documentClassifier';
import {
  classifyObservedKind,
  classifyTier1,
} from '@/platform/intake/documentDetectiveRules';
import { extractDocumentFacts } from '@/platform/intake/documentExtractionEngine';
import { readIntakeDocument } from '@/platform/intake/documentReader';
import type { DocumentReadResult } from '@/platform/intake/documentExtractionTypes';
import type {
  DocumentKind,
  Tier1ClassifyInput,
  Tier1WarningReason,
} from '@/platform/intake/documentDetectiveTypes';
import type { Provider } from '@/platform/providers/Provider';

interface GoldenFact {
  fact_kind: 'income_annual' | 'spending_monthly';
  amount: number;
  currency: string;
  page: number;
  quote: string;
}

interface GoldenFixture {
  id: string;
  file: string;
  mime_type: string;
  reader: { mode: 'text' | 'scanned' | 'encrypted'; ocr_confidence?: number };
  document_kind: DocumentKind;
  license_side?: 'front' | 'back';
  pages: Array<{ page: number; text: string }>;
  expected_source_snippets: string[];
  expected_extracted_facts: GoldenFact[];
  tier1_targets: Array<{
    target: string;
    warn: boolean;
    reason?: Tier1WarningReason;
  }>;
}

interface GoldenManifest {
  fixture_set: string;
  synthetic: boolean;
  fixtures: GoldenFixture[];
}

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/intake-document-detective'
);
const manifest = JSON.parse(
  readFileSync(resolve(fixtureDirectory, 'manifest.json'), 'utf8')
) as GoldenManifest;
const matterFolderPath = '/workspace/Clients/Synthetic Household';

function fixtureText(fixture: GoldenFixture): string {
  return fixture.pages.map((page) => page.text).join('\n');
}

function workspaceForFixture(fixture: GoldenFixture) {
  const bytes = readFileSync(resolve(fixtureDirectory, fixture.file));
  const fileBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return {
    readFileBinary: vi.fn().mockResolvedValue(fileBytes),
    isSymlink: vi.fn().mockResolvedValue(false),
    resolveSymlink: vi.fn(),
  };
}

async function readFixture(
  fixture: GoldenFixture
): Promise<DocumentReadResult> {
  return readIntakeDocument({
    path: `${matterFolderPath}/Requests/onboarding/${fixture.id}.pdf`,
    matterFolderPath,
    workspaceService: workspaceForFixture(fixture),
    mimeType: fixture.mime_type,
    dependencies: {
      extractPdfText: vi.fn().mockResolvedValue({
        encrypted: fixture.reader.mode === 'encrypted',
        scanned: fixture.reader.mode === 'scanned',
        pageCount: fixture.pages.length,
        pages: fixture.pages.map((page) => page.text),
      }),
      renderPdfPageToPng: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      isOcrEngineAvailable: () => fixture.reader.mode === 'scanned',
      ocrPageImage: vi.fn().mockResolvedValue({
        text: fixture.pages[0]?.text ?? '',
        confidence: fixture.reader.ocr_confidence ?? 100,
      }),
      destroyOcrClient: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function tier1Input(
  fixture: GoldenFixture,
  target: string
): Tier1ClassifyInput {
  const isLicenseTarget =
    target === 'license_front' || target === 'license_back_after_front';
  return {
    item: isLicenseTarget
      ? {
          item_id: 'license',
          label: "Driver's license",
          expected_license_slots: ['front', 'back'] as Array<'front' | 'back'>,
        }
      : {
          item_id: target,
          label: target,
          expected_doc_types:
            fixture.document_kind === 'unknown' ? [] : [fixture.document_kind],
        },
    slotIndex: target === 'license_back_after_front' ? 1 : 0,
    slotRole:
      target === 'license_back_after_front'
        ? ('back' as const)
        : target === 'license_front'
          ? ('front' as const)
          : ('file' as const),
    ...(target === 'license_back_after_front'
      ? { siblingLicenseSide: 'front' as const }
      : {}),
    file: {
      name: fixture.file.split('/').at(-1) ?? fixture.file,
      mimeType: fixture.mime_type,
      byteSize: readFileSync(resolve(fixtureDirectory, fixture.file))
        .byteLength,
      textSample: fixtureText(fixture),
    },
  };
}

function mockProvider(facts: unknown[]): Provider {
  return {
    getMetadata: () => ({ model: 'synthetic-fixture-model' }),
    sendMessage: vi.fn(),
    structuredOutput: vi.fn().mockResolvedValue({ facts }),
    formatAttachmentForRequest: vi.fn(),
    supportsAttachment: vi.fn(),
  };
}

function modelFacts(fixture: GoldenFixture): unknown[] {
  return [
    ...fixture.expected_extracted_facts.map((fact) => ({
      ...fact,
      confidence: 'high',
      reason: 'Printed synthetic total.',
    })),
    {
      fact_kind: 'income_annual',
      amount: 123456789,
      currency: 'USD',
      page: 1,
      quote: 'Account number 123456789',
      confidence: 'high',
      reason: 'Fabricated restricted value.',
    },
  ];
}

describe('synthetic intake-document-detective fixtures', () => {
  it('is a checked-in, deterministic set of real PDF-shaped files', () => {
    expect(manifest.fixture_set).toBe('intake-document-detective');
    expect(manifest.synthetic).toBe(true);
    expect(manifest.fixtures).toHaveLength(13);

    for (const fixture of manifest.fixtures) {
      const bytes = readFileSync(resolve(fixtureDirectory, fixture.file));
      expect(bytes.subarray(0, 8).toString('utf8')).toBe('%PDF-1.4');
      for (const page of fixture.pages) {
        for (const line of page.text.split('\n'))
          expect(bytes.toString('utf8')).toContain(line);
      }
    }
  });

  it('classifies every fixture through the reader and applies its golden Tier 1 labels', async () => {
    for (const fixture of manifest.fixtures) {
      const rawText = fixtureText(fixture);
      const observed = classifyObservedKind(rawText, fixture.file);
      expect(observed.kind, fixture.id).toBe(fixture.document_kind);
      expect(observed.side, fixture.id).toBe(fixture.license_side);

      const readResult = await readFixture(fixture);
      if (fixture.reader.mode === 'encrypted') {
        expect(readResult, fixture.id).toEqual({
          status: 'unreadable',
          reason: 'encrypted',
        });
      } else {
        expect(readResult.status, fixture.id).toBe('read');
        if (readResult.status === 'read' && fixture.reader.mode === 'scanned') {
          expect(readResult.pages[0]).toMatchObject({
            extraction: 'ocr',
            confidence: 42,
            text: '',
          });
        }
      }

      const classification = classifyIntakeDocument({
        path: `${matterFolderPath}/Requests/onboarding/${fixture.id}.pdf`,
        filename: fixture.file,
        readResult,
      });
      expect(classification.kind, fixture.id).toBe(fixture.document_kind);
      if (fixture.reader.mode === 'scanned')
        expect(classification.confidence, fixture.id).toBe('low');
      for (const snippet of fixture.expected_source_snippets) {
        expect(
          classification.sourceRefs.map((source) => source.snippet).join('\n'),
          fixture.id
        ).toContain(snippet);
      }

      for (const target of fixture.tier1_targets) {
        const tier1 = classifyTier1(tier1Input(fixture, target.target));
        expect(
          tier1.verdict === 'warn',
          `${fixture.id} for ${target.target}`
        ).toBe(target.warn);
        if (target.warn) expect(tier1).toMatchObject({ reason: target.reason });
      }
    }
  });

  it('keeps only golden income and spending facts with safe, exact cited values', async () => {
    for (const fixture of manifest.fixtures) {
      const readResult = await readFixture(fixture);
      const classification = classifyIntakeDocument({
        path: `${matterFolderPath}/Requests/onboarding/${fixture.id}.pdf`,
        filename: fixture.file,
        readResult,
      });
      const result = await extractDocumentFacts({
        readResult,
        classification,
        matterId: 'matter-synthetic',
        requestId: 'request-synthetic',
        intakeId: 'intake-synthetic',
        sourcePath: `${matterFolderPath}/Requests/onboarding/${fixture.id}.pdf`,
        provider: mockProvider(modelFacts(fixture)),
        providerId: 'synthetic-fixture-provider',
        now: new Date('2026-01-01T00:00:00.000Z'),
      });

      expect(result, fixture.id).toHaveLength(
        fixture.expected_extracted_facts.length
      );
      expect(JSON.stringify(result), fixture.id).not.toContain('123456789');
      for (const [
        index,
        expected,
      ] of fixture.expected_extracted_facts.entries()) {
        const proposal = result[index];
        expect(proposal, fixture.id).toMatchObject({
          fact_kind: expected.fact_kind,
          proposed_value: {
            t: 'money',
            v: { amount: expected.amount, currency: expected.currency },
          },
          source: { page: expected.page, snippet: expected.quote },
          created_at: '2026-01-01T00:00:00.000Z',
        });
      }
    }
  });

  it('does not infer income or spending from brokerage, IRA, or medical examples', async () => {
    const ids = [
      'brokerage-statement-taxable',
      'ira-statement',
      'medical-bill',
    ];
    for (const id of ids) {
      const fixture = manifest.fixtures.find(
        (candidate) => candidate.id === id
      );
      expect(fixture, id).toBeDefined();
      if (!fixture) continue;
      const readResult = await readFixture(fixture);
      const result = await extractDocumentFacts({
        readResult,
        classification: classifyIntakeDocument({
          path: `${matterFolderPath}/${fixture.id}.pdf`,
          filename: fixture.file,
          readResult,
        }),
        matterId: 'matter-synthetic',
        requestId: 'request-synthetic',
        intakeId: 'intake-synthetic',
        sourcePath: `${matterFolderPath}/${fixture.id}.pdf`,
        provider: mockProvider(modelFacts(fixture)),
        providerId: 'synthetic-fixture-provider',
        now: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(result, id).toEqual([]);
    }
  });
});
