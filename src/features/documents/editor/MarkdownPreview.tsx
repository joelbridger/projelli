// Markdown Preview Component
// Renders markdown content as formatted HTML.
//
// v1.5 extensions on top of the original regex converter:
// - Q1: Mermaid diagram rendering (fenced ```mermaid blocks → SVG)
// - Q2: KaTeX math rendering ($$...$$ block + $...$ inline)
//
// Mermaid render is async, so conversion inserts a placeholder <div> per
// diagram up front, and a post-mount effect calls mermaid.render() and
// drops the SVG into the matching node. Syntax errors render as a small
// red error block inside the placeholder rather than crashing the preview.
//
// KaTeX renders synchronously via katex.renderToString. Math expressions
// are extracted up front (same placeholder mechanism as mermaid) so the
// regex markdown pipeline can't mangle them, then the rendered HTML is
// inlined during the post-conversion swap. Parse errors fall back to the
// raw expression with a red underline (katex's throwOnError: false
// default error styling).

import { useEffect, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

interface MermaidBlock {
  id: string;
  source: string;
}

// Initialize mermaid once per theme. Module-level flag keeps us from
// re-initializing on every preview mount, but we re-call initialize when
// the theme changes because mermaid tolerates repeat calls.
let lastMermaidTheme: 'default' | 'dark' | null = null;
function ensureMermaidInit(theme: 'default' | 'dark') {
  if (lastMermaidTheme === theme) return;
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
  lastMermaidTheme = theme;
}

function escapeHtmlString(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Schemes permitted in a rendered href/src. Anything else (javascript:,
// vbscript:, data:, file:, …) is dropped so a document can never introduce a
// scriptable or otherwise dangerous URL. Relative URLs (no scheme) are allowed.
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

// Control characters a browser IGNORES while parsing a URL. Matching them is the
// point (anti-obfuscation), so the no-control-regex lint rule is deliberately
// disabled here. CONTROL_AND_SPACE (incl. 0x20) is for scheme DETECTION — it
// collapses split schemes like `java\tscript:` into `javascript:`; CONTROL_CHARS
// is the hygiene strip applied to a URL we keep.
// eslint-disable-next-line no-control-regex -- deliberately matches C0/C1 controls + space to defeat obfuscated URL schemes
const CONTROL_AND_SPACE = /[\u0000-\u0020\u007F-\u009F]+/g;
// eslint-disable-next-line no-control-regex -- deliberately strips C0/C1 control chars from a kept URL
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Validate a file/model-derived URL destined for an href/src attribute and
 * return a value that is safe to place inside a double-quoted attribute.
 *
 * SECURITY — inert BY CONSTRUCTION. Markdown link/image URLs are untrusted
 * (they come from the opened .md/.txt document). This function does NOT depend
 * on the markdown pipeline's incidental quirks (bold/italic underscore mangling,
 * the `[^)]+` paren-truncation, or the absence of `unsafe-eval` in the CSP) for
 * safety — those were only ever accidental barriers.
 *
 *  - Control characters and spaces are stripped before scheme detection so a
 *    split scheme like `java\tscript:` cannot slip past (browsers ignore those
 *    characters when parsing a URL scheme).
 *  - An absolute URL must carry an allow-listed scheme. Images may additionally
 *    use a NON-scriptable raster `data:image/...` URI; `data:image/svg+xml` is
 *    intentionally excluded because SVG can carry script.
 *  - Anything rejected returns '' — it renders as an inert empty attribute
 *    rather than a live link/image, so nothing can execute.
 *
 * The returned value still needs escapeHtmlAttrValue() before it lands in the
 * attribute (this function validates the scheme; that one neutralizes quotes).
 */
function sanitizeUrl(rawUrl: string, opts: { allowImageData?: boolean } = {}): string {
  // The value returned when the URL is permitted: the original with any stray
  // control characters stripped for hygiene.
  const clean = rawUrl.replace(CONTROL_CHARS, '');

  // Normalize for scheme matching ONLY: strip the control chars + spaces a
  // browser ignores while parsing a scheme (defeating split/whitespace tricks
  // like `java\tscript:` or a leading-space scheme), then lower-case.
  const normalized = rawUrl.replace(CONTROL_AND_SPACE, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];

  // ALLOW-LIST — deliberately a positive allow-list, NOT a block-list: a
  // block-list silently admits every scheme it forgot (blob:, filesystem:, and
  // whatever an attacker finds next). Only the cases below are permitted; the
  // default is refusal.
  //   1. No scheme at all → a relative / anchor / query URL → safe.
  if (scheme === undefined) return clean;
  //   2. An explicitly permitted navigable scheme.
  if (SAFE_URL_SCHEMES.has(scheme)) return clean;
  //   3. Narrow image-only exception: a NON-scriptable raster data: URI
  //      (data:image/svg+xml is excluded — SVG can carry script).
  if (
    opts.allowImageData &&
    scheme === 'data' &&
    /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/.test(normalized)
  ) {
    return clean;
  }
  // Everything else — javascript:, vbscript:, file:, blob:, filesystem:,
  // data:* not matched above, and any unknown scheme — is refused to a no-op.
  return '';
}

/**
 * Escape a value for insertion inside a DOUBLE-quoted HTML attribute. Escaping
 * the quote characters is both necessary AND sufficient to prevent attribute
 * breakout: `<`, `>` and `&` are inert inside a quoted attribute value, and a
 * literal quote is the only thing that can terminate it early. `&` is
 * deliberately NOT re-escaped here — the document-wide escape at the top of
 * markdownToHtml already turned every source `&` into `&amp;`, so re-escaping
 * would double-encode the `&amp;` in legitimate query strings. Callers place
 * the result strictly inside `"..."`.
 */
function escapeHtmlAttrValue(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/**
 * Render a single math expression with KaTeX. Parse errors are rendered
 * through KaTeX's own error fallback (red underlined source) via the
 * throwOnError: false default, and any thrown exception falls back to
 * escaped source text with a local red-underline span.
 */
function renderMath(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr, { throwOnError: false, displayMode });
  } catch {
    return `<span class="text-red-500 underline decoration-red-500">${escapeHtmlString(expr)}</span>`;
  }
}

/**
 * Extract fenced ```mermaid blocks, $$block$$ math, and $inline$ math from
 * the raw markdown source. Each is replaced with an opaque placeholder
 * token that survives the regex pipeline. After markdown→HTML conversion,
 * tokens are swapped for their final HTML (a placeholder div for mermaid,
 * the KaTeX-rendered HTML for math).
 *
 * Ordering matters: mermaid first (fenced blocks can contain $), block
 * math before inline so `$$` doesn't get split by the inline pattern.
 */
function extractSpecialBlocks(markdown: string): {
  stripped: string;
  mermaidBlocks: MermaidBlock[];
  placeholders: Map<string, string>;
} {
  const mermaidBlocks: MermaidBlock[] = [];
  const placeholders = new Map<string, string>();
  let counter = 0;
  const tokenFor = (kind: string) => `\u0000MDPREVIEW${kind}${counter++}\u0000`;

  let stripped = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_match, source: string) => {
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    mermaidBlocks.push({ id, source: source.trim() });
    const token = tokenFor('MERMAID');
    placeholders.set(
      token,
      `<div class="mermaid-diagram my-4" data-mermaid-id="${id}" data-testid="mermaid-diagram-${id}"></div>`,
    );
    return token;
  });

  // Block math: $$...$$. Runs before inline so the outer `$$` doesn't get
  // chopped into two bare `$` pairs. Match is non-greedy and multi-line.
  stripped = stripped.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr: string) => {
    const token = tokenFor('KATEXBLOCK');
    const rendered = renderMath(expr.trim(), true);
    placeholders.set(
      token,
      `<div class="katex-block my-4" data-testid="katex-block">${rendered}</div>`,
    );
    return token;
  });

  // Inline math: $...$. Tightened to:
  //   - a non-backslash/non-dollar lookbehind (so `\$` and `$$` are skipped)
  //   - no newline in the expression
  //   - no leading/trailing whitespace (so `a $ b` isn't math)
  //   - not immediately followed by a digit (so `$5 ... $10` isn't matched)
  stripped = stripped.replace(
    /(?<![\\$])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g,
    (match, expr: string) => {
      if (!expr.trim()) return match;
      const token = tokenFor('KATEXINLINE');
      const rendered = renderMath(expr, false);
      placeholders.set(
        token,
        `<span class="katex-inline" data-testid="katex-inline">${rendered}</span>`,
      );
      return token;
    },
  );

  return { stripped, mermaidBlocks, placeholders };
}

/**
 * Simple markdown to HTML converter
 * Handles common markdown syntax without external dependencies
 */
function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^######\s+(.*)$/gm, '<h6 class="text-sm font-semibold mt-4 mb-2">$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5 class="text-sm font-semibold mt-4 mb-2">$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3 border-b pb-2">$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4 border-b pb-2">$1</h1>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del class="line-through text-muted-foreground">$1</del>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted font-mono text-sm">$1</code>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="my-4 p-4 rounded-lg bg-muted overflow-x-auto"><code class="font-mono text-sm">${code.trim()}</code></pre>`;
  });

  // Blockquotes
  html = html.replace(/^>\s+(.*)$/gm, '<blockquote class="border-l-4 border-muted-foreground/30 pl-4 italic text-muted-foreground my-2">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-6 border-t border-border" />');
  html = html.replace(/^\*\*\*$/gm, '<hr class="my-6 border-t border-border" />');

  // Links — the URL is untrusted, so validate its scheme and escape it into the
  // href attribute (both are required; see sanitizeUrl / escapeHtmlAttrValue).
  // The link text ($1) is already HTML-escaped by the document-wide pass above
  // and lands in text (not attribute) context, so it needs no further handling.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
    const href = escapeHtmlAttrValue(sanitizeUrl(url));
    return `<a href="${href}" class="text-primary underline hover:no-underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Images — same treatment for the src URL (raster data: URIs additionally
  // allowed), and the alt text lands in an attribute so it is escaped too.
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) => {
    const src = escapeHtmlAttrValue(sanitizeUrl(url, { allowImageData: true }));
    const altAttr = escapeHtmlAttrValue(alt);
    return `<img src="${src}" alt="${altAttr}" class="max-w-full h-auto my-4 rounded" />`;
  });

  // Task lists (must be before regular lists)
  html = html.replace(/^(\s*)-\s+\[x\]\s+(.*)$/gm, (_match, indent, text) => {
    const level = Math.floor(indent.length / 2);
    const marginLeft = level * 1.5;
    return `<div class="flex items-center gap-2 my-1" style="margin-left: ${marginLeft}rem;"><input type="checkbox" checked disabled class="rounded" /><span class="line-through text-muted-foreground">${text}</span></div>`;
  });
  html = html.replace(/^(\s*)-\s+\[\s?\]\s+(.*)$/gm, (_match, indent, text) => {
    const level = Math.floor(indent.length / 2);
    const marginLeft = level * 1.5;
    return `<div class="flex items-center gap-2 my-1" style="margin-left: ${marginLeft}rem;"><input type="checkbox" disabled class="rounded" /><span>${text}</span></div>`;
  });

  // Unordered lists with indentation support
  html = html.replace(/^(\s*)-\s+(.*)$/gm, (_match, indent, text) => {
    const level = Math.floor(indent.length / 2);
    const marginLeft = level * 1.5;
    return `<li class="ml-4 list-disc" style="margin-left: ${marginLeft}rem;">${text}</li>`;
  });
  html = html.replace(/^(\s*)\*\s+(.*)$/gm, (_match, indent, text) => {
    const level = Math.floor(indent.length / 2);
    const marginLeft = level * 1.5;
    return `<li class="ml-4 list-disc" style="margin-left: ${marginLeft}rem;">${text}</li>`;
  });

  // Ordered lists with indentation support
  html = html.replace(/^(\s*)\d+\.\s+(.*)$/gm, (_match, indent, text) => {
    const level = Math.floor(indent.length / 2);
    const marginLeft = level * 1.5;
    return `<li class="ml-4 list-decimal" style="margin-left: ${marginLeft}rem;">${text}</li>`;
  });

  // Wrap consecutive list items in ul/ol tags
  html = html.replace(/(<li class="ml-4 list-disc"[^>]*>.*<\/li>\n?)+/g, (match) => `<ul class="my-2">${match}</ul>`);
  html = html.replace(/(<li class="ml-4 list-decimal"[^>]*>.*<\/li>\n?)+/g, (match) => `<ol class="my-2">${match}</ol>`);

  // Paragraphs (lines not already wrapped)
  html = html
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      // Don't wrap if already an HTML element
      if (block.startsWith('<')) return block;
      // Wrap in paragraph
      return `<p class="my-3">${block}</p>`;
    })
    .join('\n');

  // Single line breaks within paragraphs
  html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br />$2');

  return html;
}

/**
 * Build the final HTML string:
 *   1. Extract mermaid + math placeholders from the raw source
 *   2. Run the markdown regex pipeline on the stripped source
 *   3. Swap each placeholder token for its final HTML
 *
 * Exported for unit-testability.
 */
export function renderMarkdownToHtml(content: string): {
  html: string;
  mermaidBlocks: MermaidBlock[];
} {
  const { stripped, mermaidBlocks, placeholders } = extractSpecialBlocks(content);
  let html = markdownToHtml(stripped);
  for (const [token, replacement] of placeholders) {
    html = html.split(token).join(replacement);
  }
  return { html, mermaidBlocks };
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { html, mermaidBlocks } = useMemo(() => renderMarkdownToHtml(content), [content]);

  // Render each Mermaid diagram after React paints the placeholder <div>s.
  // Cancellation flag guards against a new content change firing a fresh
  // effect before the previous pass finishes.
  useEffect(() => {
    if (!containerRef.current || mermaidBlocks.length === 0) return;
    const root = containerRef.current;
    const isDark = document.documentElement.classList.contains('dark');
    ensureMermaidInit(isDark ? 'dark' : 'default');

    let cancelled = false;
    void (async () => {
      for (const block of mermaidBlocks) {
        const target = root.querySelector<HTMLElement>(`[data-mermaid-id="${block.id}"]`);
        if (!target) continue;
        try {
          const { svg } = await mermaid.render(`${block.id}-svg`, block.source);
          if (cancelled) return;
          target.innerHTML = svg;
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          target.innerHTML = `<div class="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-3 font-mono whitespace-pre-wrap" data-testid="mermaid-error">${escapeHtmlString(msg)}</div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html, mermaidBlocks]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full overflow-auto p-6 prose prose-sm dark:prose-invert max-w-none',
        className
      )}
      data-testid="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MarkdownPreview;
