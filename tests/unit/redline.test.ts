// Unit tests for the AI redline core (WS-A / A4).
//
// Covers the pure middle: prompt-building (paragraph indices present), the
// structured-output schema, validation/normalization of the model's edit list,
// and the structured-edit -> provider-call -> normalized-edits translation with
// a mocked Provider. The engine application itself is exercised by the engine's
// Rust tests and the DocxEditor component test.

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  REDLINE_SCHEMA,
  REDLINE_SYSTEM_PROMPT,
  buildRedlinePrompt,
  extractIndexedParagraphs,
  normalizeEdits,
  paragraphPlainRunText,
  requestRedlineEdits,
} from '@/features/documents/docx/redline';
import type { DocumentJson } from '@/platform/types/docx';
import type { Provider } from '@/platform/providers/Provider';
import { createProvider } from '@/platform/providers/providerFactory';

function sampleDoc(): DocumentJson {
  return {
    formatVersion: 1,
    body: [
      {
        kind: 'paragraph',
        propertiesXml: '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
        inlines: [{ kind: 'run', text: 'Indemnification' }],
      },
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'run', text: 'The Company shall indemnify the Client ' },
          // Existing tracked insertion — its text is NOT part of the
          // anchorable plain-run surface and must be excluded from the prompt.
          {
            kind: 'insertion',
            meta: { id: '101', author: 'Opposing Counsel', date: '2026-01-01T00:00:00Z' },
            runs: [{ text: 'and its affiliates ' }],
          },
          { kind: 'run', text: 'for all losses.' },
        ],
      },
      // A raw block (table) — has no paragraph index, must be skipped.
      { kind: 'raw', xml: '<w:tbl/>' },
      {
        kind: 'paragraph',
        inlines: [{ kind: 'run', text: 'Governed by Delaware law.' }],
      },
    ],
    comments: {},
  };
}

describe('redline — text extraction', () => {
  it('paragraphPlainRunText excludes text inside existing revisions', () => {
    const doc = sampleDoc();
    const p1 = doc.body[1];
    if (p1?.kind !== 'paragraph') throw new Error('expected paragraph');
    // The w:ins "and its affiliates " is excluded; only plain runs remain.
    expect(paragraphPlainRunText(p1)).toBe(
      'The Company shall indemnify the Client for all losses.',
    );
  });

  it('extractIndexedParagraphs assigns contiguous indices, skipping raw blocks', () => {
    const paras = extractIndexedParagraphs(sampleDoc());
    // 3 paragraphs (the raw table is skipped), indexed 0,1,2 in order.
    expect(paras.map((p) => p.paragraphIndex)).toEqual([0, 1, 2]);
    expect(paras[0]?.text).toBe('Indemnification');
    expect(paras[2]?.text).toBe('Governed by Delaware law.');
  });
});

describe('redline — prompt building', () => {
  it('includes the instruction and explicit [P#] paragraph indices', () => {
    const paras = extractIndexedParagraphs(sampleDoc());
    const prompt = buildRedlinePrompt('make it more formal', paras);
    expect(prompt).toContain('INSTRUCTION: make it more formal');
    // Every paragraph index appears with its label.
    expect(prompt).toContain('[P0]');
    expect(prompt).toContain('[P1]');
    expect(prompt).toContain('[P2]');
    expect(prompt).toContain('The Company shall indemnify the Client for all losses.');
    // Instructs the model to quote anchorText verbatim.
    expect(prompt).toMatch(/anchorText.*VERBATIM/i);
  });

  it('marks out-of-selection paragraphs as context-only when a selection is given', () => {
    const paras = extractIndexedParagraphs(sampleDoc());
    const prompt = buildRedlinePrompt('tighten clause', paras, {
      startParagraph: 1,
      endParagraph: 1,
    });
    expect(prompt).toContain('Only edit paragraphs P1 through P1');
    // P0 + P2 carry the context-only marker; P1 does not.
    expect(prompt).toMatch(/\[P0\] \(context only\)/);
    expect(prompt).toMatch(/\[P2\] \(context only\)/);
    expect(prompt).not.toMatch(/\[P1\] \(context only\)/);
  });
});

describe('redline — schema', () => {
  it('requires an edits array of op/paragraphIndex objects', () => {
    expect(REDLINE_SCHEMA.type).toBe('object');
    expect(REDLINE_SCHEMA.required).toContain('edits');
    const edits = REDLINE_SCHEMA.properties?.['edits'];
    expect(edits?.type).toBe('array');
    expect(edits?.items?.required).toEqual(['op', 'paragraphIndex']);
    expect(Object.keys(edits?.items?.properties ?? {})).toEqual(
      expect.arrayContaining(['op', 'paragraphIndex', 'anchorText', 'newText', 'reason']),
    );
  });
});

describe('redline — normalizeEdits (untrusted model output)', () => {
  it('keeps well-formed edits and coerces numeric paragraphIndex', () => {
    const out = normalizeEdits({
      edits: [
        { op: 'replace', paragraphIndex: 1, anchorText: 'Delaware', newText: 'New York', reason: 'venue' },
        { op: 'insert', paragraphIndex: '0', newText: ' (Draft)', reason: 'label' },
        { op: 'delete', paragraphIndex: 2, anchorText: 'foo' },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      op: 'replace',
      paragraphIndex: 1,
      anchorText: 'Delaware',
      newText: 'New York',
      reason: 'venue',
    });
    // string "0" coerced to number 0.
    expect(out[1]?.paragraphIndex).toBe(0);
  });

  it('drops edits missing op-required fields or with unknown op', () => {
    const out = normalizeEdits({
      edits: [
        { op: 'delete', paragraphIndex: 0 }, // missing anchorText
        { op: 'replace', paragraphIndex: 0, anchorText: 'x' }, // missing newText
        { op: 'insert', paragraphIndex: 0 }, // missing newText
        { op: 'frobnicate', paragraphIndex: 0, anchorText: 'x', newText: 'y' }, // bad op
        { op: 'delete', paragraphIndex: -1, anchorText: 'x' }, // bad index
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('returns [] for a totally unusable response', () => {
    expect(normalizeEdits(null)).toEqual([]);
    expect(normalizeEdits({})).toEqual([]);
    expect(normalizeEdits({ edits: 'nope' })).toEqual([]);
  });
});

describe('redline — requestRedlineEdits (provider translation)', () => {
  it('calls structuredOutput with the schema + system prompt and normalizes the result', async () => {
    const structuredOutput = vi.fn().mockResolvedValue({
      edits: [
        { op: 'replace', paragraphIndex: 3, anchorText: 'Delaware', newText: 'New York', reason: 'venue' },
        { op: 'bad' }, // dropped by normalization
      ],
    });
    const provider = { structuredOutput } as unknown as Provider;

    const edits = await requestRedlineEdits(provider, 'change venue to NY', sampleDoc());

    // Provider called once with our schema + redline system prompt + temp 0.
    expect(structuredOutput).toHaveBeenCalledTimes(1);
    const [promptArg, optsArg] = structuredOutput.mock.calls[0]!;
    expect(promptArg).toContain('INSTRUCTION: change venue to NY');
    expect(optsArg.schema).toBe(REDLINE_SCHEMA);
    expect(optsArg.systemPrompt).toBe(REDLINE_SYSTEM_PROMPT);
    expect(optsArg.temperature).toBe(0);

    // Only the valid edit survives normalization.
    expect(edits).toEqual([
      { op: 'replace', paragraphIndex: 3, anchorText: 'Delaware', newText: 'New York', reason: 'venue' },
    ]);
  });

  it('returns [] when the model proposes no edits', async () => {
    const provider = {
      structuredOutput: vi.fn().mockResolvedValue({ edits: [] }),
    } as unknown as Provider;
    expect(await requestRedlineEdits(provider, 'nothing to do', sampleDoc())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WS-C honesty — a redline in Local-only mode must run on the LOCAL model
// (Ollama, 127.0.0.1) and never reach a cloud provider. DocxEditor constructs
// its redline provider via `createProvider({ provider: 'ollama', ... })`; here
// we exercise that construction point end-to-end against a mocked fetch and
// assert the request goes ONLY to the local daemon.
// ---------------------------------------------------------------------------
describe('redline — local (Ollama) routing (the honesty guarantee)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('routes a local redline to 127.0.0.1 (Ollama) and never to a cloud host', async () => {
    const urls: string[] = [];
    // Mock fetch: record every URL, return an Ollama-shaped JSON edit list.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'llama3.2:3b',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              edits: [
                { op: 'replace', paragraphIndex: 3, anchorText: 'Delaware', newText: 'New York', reason: 'venue' },
              ],
            }),
          },
          done: true,
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    // The construction point DocxEditor uses for a local redline. No API key.
    const provider = createProvider({ provider: 'ollama', model: 'llama3.2:3b' });
    const edits = await requestRedlineEdits(provider, 'change venue to NY', sampleDoc());

    // The edit list came back normalized.
    expect(edits).toEqual([
      { op: 'replace', paragraphIndex: 3, anchorText: 'Delaware', newText: 'New York', reason: 'venue' },
    ]);

    // Every request went to the LOCAL daemon — never a cloud provider host.
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain('127.0.0.1:11434');
      expect(u).not.toMatch(/anthropic|openai|googleapis/i);
    }
  });
});
