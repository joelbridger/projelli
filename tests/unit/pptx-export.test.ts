import { describe, it, expect } from 'vitest';
import { buildPptxFromSlideJSON } from '../../src/utils/pptx-io';

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
