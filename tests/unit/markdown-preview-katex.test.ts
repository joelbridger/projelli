// Unit tests for the KaTeX math rendering path in MarkdownPreview.
// We test at the renderMarkdownToHtml boundary: verify the final HTML
// contains KaTeX-generated output for both inline `$...$` and block
// `$$...$$` expressions, and that ordering handles `$$` before `$` so
// block delimiters aren't chopped by the inline pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderMarkdownToHtml } from '@/components/editor/MarkdownPreview';
import katex from 'katex';

describe('MarkdownPreview — KaTeX math', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders inline $...$ as a span wrapped in KaTeX markup', () => {
    const md = 'Einstein said $E = mc^2$ once.';
    const { html } = renderMarkdownToHtml(md);

    // Inline wrapper.
    expect(html).toContain('<span class="katex-inline"');
    expect(html).toContain('data-testid="katex-inline"');
    // KaTeX injects its own span with class="katex" + MathML + HTML output.
    expect(html).toContain('class="katex"');
    // Raw expression should NOT survive unrendered (no literal $E = mc^2$).
    expect(html).not.toMatch(/\$E = mc\^2\$/);
    // Literal source characters of the formula should appear somewhere
    // inside the rendered KaTeX output (e.g. the MathML annotation).
    expect(html).toContain('E = mc^2');
  });

  it('renders block $$...$$ as a div with displayMode KaTeX', () => {
    const md = [
      'See the formula:',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
      '$$',
      '',
      'end.',
    ].join('\n');

    const { html } = renderMarkdownToHtml(md);
    expect(html).toContain('<div class="katex-block my-4"');
    expect(html).toContain('data-testid="katex-block"');
    // Display mode pulls in katex-display wrapping.
    expect(html).toContain('katex-display');
    // Surrounding prose still renders.
    expect(html).toContain('See the formula');
    expect(html).toContain('end.');
  });

  it('processes block math before inline so $$ delimiters are not split', () => {
    // If inline ran first it would match `$..$` inside the block.
    const md = '$$a + b = c$$';
    const { html } = renderMarkdownToHtml(md);
    expect(html).toContain('data-testid="katex-block"');
    expect(html).not.toContain('data-testid="katex-inline"');
  });

  it('calls katex.renderToString with displayMode=true for $$ and false for $', () => {
    const spy = vi.spyOn(katex, 'renderToString');
    const md = 'inline $a$ and block $$b$$ together.';

    renderMarkdownToHtml(md);

    // Two calls expected: one block, one inline.
    expect(spy).toHaveBeenCalledTimes(2);

    const calls = spy.mock.calls;
    // Block call comes first (extraction order).
    expect(calls[0]![0]).toBe('b');
    expect(calls[0]![1]).toMatchObject({ displayMode: true, throwOnError: false });
    // Inline next.
    expect(calls[1]![0]).toBe('a');
    expect(calls[1]![1]).toMatchObject({ displayMode: false, throwOnError: false });
  });

  it('does not match currency like "$5 total" as inline math', () => {
    // `$5 ... $10` shouldn't become an inline math span.
    const md = 'It costs $5 today and $10 tomorrow.';
    const { html } = renderMarkdownToHtml(md);
    expect(html).not.toContain('data-testid="katex-inline"');
    expect(html).not.toContain('class="katex"');
  });

  it('ignores escaped dollar signs', () => {
    const md = 'literal \\$x\\$ should not render.';
    const { html } = renderMarkdownToHtml(md);
    expect(html).not.toContain('data-testid="katex-inline"');
  });

  it('falls back gracefully on invalid math (throwOnError:false)', () => {
    // KaTeX with throwOnError: false renders a red-underlined span on
    // parse error instead of throwing. We just assert the wrapper landed
    // and no exception bubbled.
    const md = 'bad $\\invalidcommand{foo}$ expr';
    const result = renderMarkdownToHtml(md);
    expect(result.html).toContain('data-testid="katex-inline"');
  });
});
