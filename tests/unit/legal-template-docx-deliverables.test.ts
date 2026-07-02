/**
 * F-112 — Legal pack deliverables must be real .docx files, not .md files.
 *
 * Keepance 3.0 positions Word as the first-class format: "Real Word documents
 * in a normal folder." Every legal template's generate/analyze step should
 * produce a .docx deliverable, not a SCREAMING_SNAKE .md file.
 *
 * Tests:
 *   1. All 19 legal templates (including DepositionContradictionFinder and the
 *      VG-3d Issue Spotter) declare an outputFile ending in `.docx` (not `.md`).
 *
 *   2. The WorkflowEngine.writeDeliverable path for a .docx outputFile calls
 *      `writeFileBinary` (not `writeFile`), confirming the engine writes a real
 *      Word document when a binary writer is available.
 *
 *   3. Representative spot-check: ClientIntakeSynthesizer (the flagship template
 *      whose conflict-check table is F-108's target) declares `.docx` as its
 *      outputFile and output artifact.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { LEGAL_TEMPLATES } from '../../src/features/workflows/engine/templates/legal/index';
import { WorkflowEngine } from '../../src/features/workflows/engine/WorkflowEngine';
import { MockProvider } from '../../src/platform/providers/MockProvider';
import { serializeContradictionsDocx } from '../../src/platform/utils/docx-io';
import type { WorkflowTemplate, ContradictionAnalysisResult } from '../../src/platform/types/workflow';

// ─── 1. All legal templates declare .docx outputFile ─────────────────────────

describe('F-112 — legal pack templates: all outputFiles are .docx', () => {
  it('every legal template has 19 entries total', () => {
    expect(LEGAL_TEMPLATES).toHaveLength(19);
  });

  for (const template of LEGAL_TEMPLATES) {
    it(`${template.id ?? template.name} — outputFile ends with .docx`, () => {
      const generateOrAnalyzeSteps = template.steps.filter(
        (s) => s.type === 'generate' || s.type === 'analyze'
      );
      // Every generate/analyze step must have a .docx outputFile.
      expect(generateOrAnalyzeSteps.length).toBeGreaterThan(0);
      for (const step of generateOrAnalyzeSteps) {
        const config = step.config as { outputFile?: string };
        expect(config.outputFile).toBeDefined();
        expect(config.outputFile!.toLowerCase()).toMatch(/\.docx$/);
      }
    });

    it(`${template.id ?? template.name} — outputs[] array entries end with .docx`, () => {
      for (const outputEntry of template.outputs) {
        expect(outputEntry.toLowerCase()).toMatch(/\.docx$/);
      }
    });
  }
});

// ─── 2. WorkflowEngine routes .docx outputFile through writeFileBinary ────────

describe('F-112 — WorkflowEngine: .docx outputFile uses writeFileBinary', () => {
  it('calls writeFileBinary (not writeFile) when outputFile is .docx and binary writer is wired', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const writeFileBinary = vi.fn().mockResolvedValue(undefined);
    const readFile = vi.fn().mockResolvedValue('');

    const engine = new WorkflowEngine(
      new MockProvider(),
      { writeFile, writeFileBinary, readFile },
      vi.fn().mockResolvedValue({})
    );

    // Create a minimal generate template with a .docx outputFile.
    const template: WorkflowTemplate = {
      id: 'test-docx-template',
      name: 'Test DOCX Template',
      description: 'Verify .docx routing',
      version: '1.0.0',
      category: 'legal',
      steps: [
        {
          id: 'gen',
          type: 'generate',
          name: 'Generate',
          description: 'Generate output',
          config: {
            outputFile: 'TEST_OUTPUT.docx',
            promptTemplate: 'Write a short summary.',
          },
        },
      ],
      requiredInputs: [],
      outputs: ['TEST_OUTPUT.docx'],
    };

    await engine.execute(template, {});

    // writeFileBinary must have been called (for the .docx)
    expect(writeFileBinary).toHaveBeenCalledTimes(1);
    // writeFile should NOT have been called for the .docx
    // (it may be called for audit/run-record purposes but NOT with a .docx path)
    const writeFileCalls = writeFile.mock.calls as [string, string][];
    const docxWriteFileCalls = writeFileCalls.filter(([path]) =>
      typeof path === 'string' && path.toLowerCase().endsWith('.docx')
    );
    expect(docxWriteFileCalls).toHaveLength(0);

    // The bytes passed to writeFileBinary must be a valid zip (PK magic).
    const [, bytes] = writeFileBinary.mock.calls[0] as [string, Uint8Array];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'

    // Verify it's a valid .docx (zip with word/document.xml).
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('word/document.xml')).not.toBeNull();
  });
});

// ─── 3. Spot-check: ClientIntakeSynthesizer declares .docx ───────────────────

describe('F-112 — ClientIntakeSynthesizer is .docx (flagship template)', () => {
  it('ClientIntakeSynthesizer outputFile is CLIENT_INTAKE_PACKAGE.docx', () => {
    const template = LEGAL_TEMPLATES.find((t) => t.id === 'legal-client-intake' || t.name.includes('Client Intake'));
    expect(template).toBeDefined();
    const generateStep = template!.steps.find((s) => s.type === 'generate');
    expect(generateStep).toBeDefined();
    const config = generateStep!.config as { outputFile: string };
    expect(config.outputFile).toBe('CLIENT_INTAKE_PACKAGE.docx');
    expect(template!.outputs).toContain('CLIENT_INTAKE_PACKAGE.docx');
  });
});

// ─── 4. VG-3b — retrieval-unavailable honesty header in the deliverable ──────

describe('VG-3b — contradictions docx carries the retrieval-unavailable note', () => {
  it('renders the retrievalNote sentence in the document header', async () => {
    const result: ContradictionAnalysisResult = {
      findings: [],
      totalCount: 0,
      verifiedCount: 0,
      unverifiedCount: 0,
    };
    const note =
      'Analyzed only the excerpts you provided; workspace retrieval was unavailable for this run.';
    const bytes = await serializeContradictionsDocx(result, {
      title: 'Deposition Contradiction Analysis: Jane Doe',
      verificationBanner: 'Verify before relying.',
      retrievalNote: note,
    });

    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain(note);
  });
});
