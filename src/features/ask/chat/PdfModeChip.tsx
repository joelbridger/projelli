/**
 * Stream A2 — Small chip that appears in AI chat history next to a PDF
 * attachment, indicating how the PDF was processed.
 *
 * - "Native PDF"    — bytes sent directly as Anthropic document block
 *                     (Claude Sonnet/Opus 3.5+)
 * - "Text extract"  — PDF.js extracted the text and sent it as a text block
 *                     (all other providers + Claude Haiku)
 */
import { FileText, FileSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PdfMode } from '@/platform/providers/pdf-capability';

export interface PdfModeChipProps {
  mode: PdfMode;
  className?: string;
}

export function PdfModeChip({ mode, className }: PdfModeChipProps) {
  const isNative = mode === 'native';

  return (
    <span
      data-testid="pdf-mode-chip"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'text-[10px] font-medium leading-none',
        isNative
          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
        className
      )}
    >
      {isNative ? (
        <FileText className="h-2.5 w-2.5 shrink-0" aria-hidden />
      ) : (
        <FileSearch className="h-2.5 w-2.5 shrink-0" aria-hidden />
      )}
      {isNative ? 'Native PDF' : 'Text extract'}
    </span>
  );
}

export default PdfModeChip;
