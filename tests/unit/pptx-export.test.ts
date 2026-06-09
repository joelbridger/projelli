import { describe, it, expect } from 'vitest';
import { buildPptxFromSlideJSON, extractPptxText } from '../../src/utils/pptx-io';

describe('structured PPTX export', () => {
  it('builds a PPTX buffer from slide JSON with speaker notes', async () => {
    const slides = [
      {
        title: 'Market Opportunity',
        layout: 'bullets' as const,
        bullets: ['$2B TAM', '15% CAGR', 'Fragmented incumbents'],
        speakerNotes: 'Emphasize the TAM is conservative.',
        tableData: null,
      },
    ];
    const buffer = await buildPptxFromSlideJSON(slides, { firmName: 'Acme Consulting' });
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('exports without firm name', async () => {
    const slides = [
      { title: 'Findings', layout: 'bullets' as const, bullets: ['Finding 1'], speakerNotes: '', tableData: null },
    ];
    const buffer = await buildPptxFromSlideJSON(slides, {});
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('handles table slide layout', async () => {
    const slides = [
      {
        title: 'Competitive Matrix',
        layout: 'table' as const,
        bullets: [],
        speakerNotes: '',
        tableData: {
          headers: ['Competitor', 'Strength', 'Gap'],
          rows: [['Acme', 'Brand', 'Price'], ['Beta', 'Price', 'Support']],
        },
      },
    ];
    const buffer = await buildPptxFromSlideJSON(slides, {});
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(500);
  });
});

// A6 — confirm the pptx path round-trips slide TEXT: build a deck, then extract
// its text back from the .pptx bytes (the same extraction the AI ambient-context
// + fallback renderer use). The titles and bullets we put in must come back out.
describe('pptx text round-trip (A6)', () => {
  it('round-trips slide titles and bullet text through build -> extract', async () => {
    const slides = [
      {
        title: 'Engagement Scope',
        layout: 'bullets' as const,
        bullets: ['Discovery interviews', 'Process mapping', 'Final readout'],
        speakerNotes: 'Keep it tight.',
        tableData: null,
      },
      {
        title: 'Timeline',
        layout: 'bullets' as const,
        bullets: ['Phase one kickoff', 'Midpoint review'],
        speakerNotes: '',
        tableData: null,
      },
    ];

    const bytes = await buildPptxFromSlideJSON(slides, { firmName: 'Boutique Strategy' });
    // extractPptxText accepts a data URL or an ArrayBuffer.
    const text = await extractPptxText(bytes.buffer as ArrayBuffer);

    // Titles survived.
    expect(text).toContain('Engagement Scope');
    expect(text).toContain('Timeline');
    // Bullet text survived.
    expect(text).toContain('Discovery interviews');
    expect(text).toContain('Final readout');
    expect(text).toContain('Midpoint review');
    // The firm-name cover slide text is present too.
    expect(text).toContain('Boutique Strategy');
  });
});
