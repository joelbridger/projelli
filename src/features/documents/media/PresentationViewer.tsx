// Presentation Viewer
//
// Shows a PowerPoint file (`.pptx` or `.ppt`) as a rendered PDF inside the
// existing PDFViewer. The conversion is handled natively via a Rust Tauri
// command (`convert_ppt_to_pdf`) that shells out to LibreOffice.
//
// Three UI states:
//   1. Not Tauri (browser test mode): desktop-only fallback + Download button.
//   2. Tauri + LibreOffice NOT detected: install instructions + download hatch.
//   3. Tauri + LibreOffice detected: show a spinner while converting, then
//      display the resulting PDF via the existing PDFViewer component.
//
// The converted PDF is cached under the OS temp dir, so reopening the same
// file is instant. Errors surface with a "Try again" button + download
// hatch so users are never stuck.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { PDFViewer } from '@/features/documents/media/PDFViewer';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';
import { saveFile } from '@/utils/saveFile';
import {
  convertPptToPdf,
  detectLibreOffice,
} from '@/utils/tauri-commands';
import { extractSlides, type SlidePreview } from '@/utils/pptx-io';
import { AlertTriangle, Info, Loader2, Presentation } from 'lucide-react';

interface PresentationViewerProps {
  /** Data URL of the original .pptx / .ppt file (used for the download hatch). */
  src: string;
  fileName: string;
  /** Absolute on-disk path, required for the native LibreOffice invoke. */
  filePath: string;
  className?: string;
}

type LoadState =
  | { kind: 'detecting' }
  | { kind: 'browser' }
  | { kind: 'no-libreoffice' }
  | { kind: 'converting' }
  | { kind: 'ready'; pdfDataUrl: string }
  | { kind: 'fallback'; slides: SlidePreview[] }
  | { kind: 'error'; message: string };

const PDF_MIME = 'application/pdf';

/**
 * Load a PDF from disk (via the Tauri fs plugin) and wrap it in a data URL
 * so `PDFViewer` can convert it to a blob URL the same way it does for any
 * other PDF source.
 */
async function readPdfAsDataUrl(pdfPath: string): Promise<string> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(pdfPath);
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i] as number);
  }
  return `data:${PDF_MIME};base64,${btoa(binary)}`;
}

export function PresentationViewer({
  src,
  fileName,
  filePath,
  className,
}: PresentationViewerProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'detecting' });
  const inTauri = isTauriEnvironment();

  const runConversion = useCallback(async () => {
    setState({ kind: 'converting' });
    try {
      const pdfPath = await convertPptToPdf(filePath);
      const dataUrl = await readPdfAsDataUrl(pdfPath);
      setState({ kind: 'ready', pdfDataUrl: dataUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, [filePath]);

  // UX-34: pure-JS fallback — extract slide text and render as an outline
  // when LibreOffice isn't installed.
  const runFallback = useCallback(async () => {
    try {
      const slides = await extractSlides(src);
      setState({ kind: 'fallback', slides });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, [src]);

  // Kick off detection + conversion on mount.
  useEffect(() => {
    let cancelled = false;
    if (!inTauri) {
      // In the browser (dev mode), use JS fallback instead of dead end.
      void runFallback();
      return;
    }
    setState({ kind: 'detecting' });
    detectLibreOffice()
      .then((path) => {
        if (cancelled) return;
        if (path === null) {
          // No LibreOffice — fall back to pure-JS renderer.
          void runFallback();
          return;
        }
        void runConversion();
      })
      .catch(() => {
        if (!cancelled) void runFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [inTauri, filePath, runConversion, runFallback]);

  const handleDownload = useCallback(async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const buf = await blob.arrayBuffer();
      const ext = fileName.split('.').pop()?.toLowerCase();
      await saveFile(buf, {
        suggestedName: fileName,
        types: [
          {
            description: 'Presentation Files',
            accept: ext === 'ppt'
              ? { 'application/vnd.ms-powerpoint': ['.ppt'] }
              : {
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
                    '.pptx',
                  ],
                },
          },
        ],
      });
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[PresentationViewer] Download failed:', err);
      }
    }
  }, [src, fileName]);

  if (state.kind === 'ready') {
    return (
      <div
        data-testid="presentation-viewer"
        className={cn('h-full flex flex-col', className)}
      >
        <PDFViewer src={state.pdfDataUrl} fileName={fileName} className="h-full" />
      </div>
    );
  }

  // UX-34: Pure-JS fallback renderer — shows slide text as an outline.
  if (state.kind === 'fallback') {
    return (
      <div
        data-testid="presentation-viewer"
        className={cn('h-full flex flex-col', className)}
      >
        {/* Banner */}
        <div
          data-testid="presentation-fallback-banner"
          className="flex items-center gap-2 border-b bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <Info className="h-4 w-4 shrink-0" />
          <span>
            <Trans
              i18nKey="media.presentation.basic-preview"
              components={{
                a: (
                  <a
                    href="https://libreoffice.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  />
                ),
              }}
            />
          </span>
        </div>
        {/* Slide outline */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {state.slides.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('media.presentation.no-slides')}</p>
          )}
          {state.slides.map((slide) => (
            <div
              key={slide.number}
              data-testid={`fallback-slide-${slide.number}`}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                {t('media.presentation.slide-label', { number: slide.number })}
              </div>
              {slide.texts.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  {t('media.presentation.no-text-content')}
                </p>
              ) : (
                <div className="space-y-1">
                  {slide.texts.map((t, i) => (
                    <p key={i} className={i === 0 ? 'text-base font-semibold' : 'text-sm'}>
                      {t}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // All non-ready states share the same centered frame layout.
  return (
    <div
      data-testid="presentation-viewer"
      className={cn(
        'flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center',
        className
      )}
    >
      {state.kind === 'detecting' && (
        <>
          <Loader2
            data-testid="presentation-loading"
            className="h-10 w-10 mb-3 animate-spin opacity-70"
          />
          <p className="text-sm">{t('media.presentation.checking-libreoffice')}</p>
        </>
      )}

      {state.kind === 'converting' && (
        <>
          <Loader2
            data-testid="presentation-loading"
            className="h-10 w-10 mb-3 animate-spin opacity-70"
          />
          <p className="text-sm">{t('media.presentation.rendering-slides')}</p>
          <p className="mt-1 text-xs opacity-70">
            {t('media.presentation.first-open-converts')}
          </p>
        </>
      )}

      {/* UX-34: 'browser' and 'no-libreoffice' states now route to the
          JS fallback renderer above, so these dead-end screens are no
          longer reachable. Kept as a safety net in case the fallback
          extraction itself fails and lands us here somehow. */}
      {(state.kind === 'browser' || state.kind === 'no-libreoffice') && (
        <>
          <Presentation className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">{fileName}</p>
          <p className="mt-2 text-sm max-w-md">
            {t('media.presentation.cannot-preview')}
          </p>
          <Button variant="outline" className="mt-4" onClick={handleDownload}>
            {t('media.presentation.download-file')}
          </Button>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <AlertTriangle className="h-10 w-10 mb-3 text-destructive opacity-70" />
          <p className="text-lg font-medium">{t('media.presentation.could-not-render', { fileName })}</p>
          <p
            data-testid="presentation-error"
            className="mt-2 text-sm text-destructive max-w-md"
          >
            {state.message}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={runConversion}>{t('media.presentation.try-again')}</Button>
            <Button variant="outline" onClick={handleDownload}>
              {t('media.presentation.download-file')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default PresentationViewer;
