// Markdown Preview Component
// Renders markdown content as formatted HTML.
//
// v1.5 extensions on top of the original regex converter:
// - Q1: Mermaid diagram rendering (fenced ```mermaid blocks → SVG)
//
// Mermaid render is async, so conversion inserts a placeholder <div> per
// diagram up front, and a post-mount effect calls mermaid.render() and
// drops the SVG into the matching node. Syntax errors render as a small
// red error block inside the placeholder rather than crashing the preview.

import { useEffect, useMemo, useRef } from 'react';
import mermaid from 'mermaid';
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

/**
 * Extract fenced ```mermaid blocks from the raw markdown and replace each
 * with an opaque placeholder token that survives the regex pipeline. After
 * markdown→HTML conversion, tokens are swapped for placeholder <div>s that
 * the post-mount effect fills with rendered SVG.
 */
function extractMermaidBlocks(markdown: string): {
  stripped: string;
  blocks: MermaidBlock[];
  placeholders: Map<string, string>;
} {
  const blocks: MermaidBlock[] = [];
  const placeholders = new Map<string, string>();
  let counter = 0;
  const stripped = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_match, source: string) => {
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    blocks.push({ id, source: source.trim() });
    const token = `\u0000MDPREVIEWMERMAID${counter++}\u0000`;
    placeholders.set(
      token,
      `<div class="mermaid-diagram my-4" data-mermaid-id="${id}" data-testid="mermaid-diagram-${id}"></div>`,
    );
    return token;
  });
  return { stripped, blocks, placeholders };
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

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline hover:no-underline" target="_blank" rel="noopener noreferrer">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto my-4 rounded" />');

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
 * Build the final HTML string: extract Mermaid blocks → run the markdown
 * regex pipeline on the stripped source → swap placeholders for diagram
 * target <div>s. Exported for unit-testability.
 */
export function renderMarkdownToHtml(content: string): {
  html: string;
  mermaidBlocks: MermaidBlock[];
} {
  const { stripped, blocks, placeholders } = extractMermaidBlocks(content);
  let html = markdownToHtml(stripped);
  for (const [token, replacement] of placeholders) {
    html = html.split(token).join(replacement);
  }
  return { html, mermaidBlocks: blocks };
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
    (async () => {
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
