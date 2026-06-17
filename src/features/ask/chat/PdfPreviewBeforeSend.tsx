/**
 * Stream A2 — Pre-send preview panel for PDF attachments.
 *
 * Shown above the send button when a PDF is pending. Lets the user verify
 * that text was extracted correctly before the request is sent.
 *
 * Handles three states:
 * - Normal: shows first 200 chars of extracted text + page count.
 * - Scanned: warns that the PDF has no text layer; offers native-PDF escape
 *   hatch when the selected model supports it.
 * - Encrypted: shows error, hides text preview.
 */
import { useTranslation } from 'react-i18next';
import { Lock, ScanLine, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PdfMode } from '@/platform/providers/pdf-capability';

const MAX_PREVIEW_CHARS = 200;

export interface PdfPreviewBeforeSendProps {
  fileName: string;
  extractedText: string;
  pageCount: number;
  scanned: boolean;
  encrypted: boolean;
  mode: PdfMode;
  /** Called when user clicks "Send as native PDF" escape hatch. */
  onUseNative?: () => void;
  className?: string;
}

export function PdfPreviewBeforeSend({
  fileName,
  extractedText,
  pageCount,
  scanned,
  encrypted,
  mode,
  onUseNative,
  className,
}: PdfPreviewBeforeSendProps) {
  const { t } = useTranslation();
  const preview =
    extractedText.length > MAX_PREVIEW_CHARS
      ? extractedText.slice(0, MAX_PREVIEW_CHARS) + '…'
      : extractedText;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-muted/40 p-3 text-xs space-y-2',
        className
      )}
    >
      {/* Header: file name + page count */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span data-testid="pdf-preview-filename" className="font-medium truncate">
          {fileName}
        </span>
        {pageCount > 0 && (
          <span data-testid="pdf-preview-pages" className="ml-auto shrink-0">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          </span>
        )}
      </div>

      {/* Encrypted error — replaces text preview */}
      {encrypted && (
        <div
          data-testid="pdf-encrypted-error"
          role="alert"
          className="flex items-center gap-1.5 text-destructive"
        >
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {t('chat.pdf-preview.encrypted')}
          </span>
        </div>
      )}

      {/* Text preview — hidden when encrypted */}
      {!encrypted && (
        <p
          data-testid="pdf-text-preview"
          className="font-mono text-[10px] leading-relaxed text-muted-foreground bg-background/60 rounded px-2 py-1.5 whitespace-pre-wrap break-words"
        >
          {preview}
        </p>
      )}

      {/* Scanned PDF warning */}
      {scanned && !encrypted && (
        <div
          data-testid="pdf-scanned-warning"
          role="alert"
          className={cn(
            'flex items-start gap-1.5 rounded px-2 py-1.5',
            'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200',
            'border border-amber-300/60'
          )}
        >
          <ScanLine className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 space-y-1">
            <span>
              {t('chat.pdf-preview.scanned')}
            </span>
            {mode === 'native' && (
              <button
                data-testid="pdf-native-escape-hatch"
                type="button"
                onClick={onUseNative}
                className="block text-amber-700 dark:text-amber-300 underline hover:no-underline"
              >
                {t('chat.pdf-preview.send-as-native')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PdfPreviewBeforeSend;
