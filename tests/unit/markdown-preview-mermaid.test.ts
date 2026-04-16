// Unit tests for the Mermaid rendering path in MarkdownPreview.
// We test the pure extraction/render function (renderMarkdownToHtml) so
// the assertions don't depend on actual mermaid.render() output — that
// call needs a real browser layout engine and isn't a useful unit-test
// dependency. End-to-end SVG output is covered by Playwright later.

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml } from '@/components/editor/MarkdownPreview';

describe('MarkdownPreview — Mermaid extraction', () => {
  it('extracts a fenced ```mermaid block into a placeholder div', () => {
    const md = [
      '# Title',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');

    const { html, mermaidBlocks } = renderMarkdownToHtml(md);

    expect(mermaidBlocks).toHaveLength(1);
    expect(mermaidBlocks[0]!.source).toContain('graph TD');
    expect(mermaidBlocks[0]!.source).toContain('A --> B');
    expect(mermaidBlocks[0]!.id).toMatch(/^mermaid-[a-z0-9]+$/);

    expect(html).toContain('class="mermaid-diagram my-4"');
    expect(html).toContain(`data-mermaid-id="${mermaidBlocks[0]!.id}"`);
    expect(html).toContain(`data-testid="mermaid-diagram-${mermaidBlocks[0]!.id}"`);

    // Source should NOT appear verbatim inside the placeholder div.
    expect(html).not.toContain('graph TD');
    // Title should still render.
    expect(html).toContain('<h1');
  });

  it('extracts multiple mermaid blocks with unique ids', () => {
    const md = [
      '```mermaid',
      'graph TD; A --> B',
      '```',
      '',
      'middle',
      '',
      '```mermaid',
      'sequenceDiagram; A->>B: hi',
      '```',
    ].join('\n');

    const { html, mermaidBlocks } = renderMarkdownToHtml(md);
    expect(mermaidBlocks).toHaveLength(2);
    expect(mermaidBlocks[0]!.id).not.toBe(mermaidBlocks[1]!.id);
    expect(html).toContain(`data-mermaid-id="${mermaidBlocks[0]!.id}"`);
    expect(html).toContain(`data-mermaid-id="${mermaidBlocks[1]!.id}"`);
  });

  it('leaves non-mermaid fenced code blocks alone', () => {
    const md = '```ts\nconst x = 1;\n```\n';
    const { html, mermaidBlocks } = renderMarkdownToHtml(md);
    expect(mermaidBlocks).toHaveLength(0);
    // Placeholder markup should NOT appear.
    expect(html).not.toContain('mermaid-diagram');
    expect(html).not.toContain('data-mermaid-id');
  });

  it('does not leak internal placeholder tokens into the final HTML', () => {
    const md = '```mermaid\ngraph TD; A-->B\n```';
    const { html } = renderMarkdownToHtml(md);
    expect(html).not.toContain('MDPREVIEW_MERMAID');
    // And no null-byte leakage either.
    expect(html).not.toContain('\u0000');
  });
});
