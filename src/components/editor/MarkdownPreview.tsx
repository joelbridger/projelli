// Markdown Preview Component
// Renders markdown content as formatted HTML

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
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

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const html = useMemo(() => markdownToHtml(content), [content]);

  return (
    <div
      className={cn(
        'h-full w-full overflow-auto p-6 prose prose-sm dark:prose-invert max-w-none',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MarkdownPreview;
