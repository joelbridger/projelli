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

import { PDFViewer } from '@/components/media/PDFViewer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';
import { saveFile } from '@/utils/saveFile';
import {
  convertPptToPdf,
  detectLibreOffice,
} from '@/utils/tauri-commands';
import { AlertTriangle, Loader2, Presentation } from 'lucide-react';

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

  // Kick off detection + conversion on mount.
  useEffect(() => {
    let cancelled = false;
    if (!inTauri) {
      setState({ kind: 'browser' });
      return;
    }
    setState({ kind: 'detecting' });
    detectLibreOffice()
      .then((path) => {
        if (cancelled) return;
        if (path === null) {
          setState({ kind: 'no-libreoffice' });
          return;
        }
        // Kick off conversion immediately; runConversion manages its own
        // state transitions from here.
        void runConversion();
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'no-libreoffice' });
      });
    return () => {
      cancelled = true;
    };
  }, [inTauri, filePath, runConversion]);

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
          <p className="text-sm">Checking for LibreOffice...</p>
        </>
      )}

      {state.kind === 'converting' && (
        <>
          <Loader2
            data-testid="presentation-loading"
            className="h-10 w-10 mb-3 animate-spin opacity-70"
          />
          <p className="text-sm">Rendering slides...</p>
          <p className="mt-1 text-xs opacity-70">
            First open converts the deck; later opens are instant.
          </p>
        </>
      )}

      {state.kind === 'browser' && (
        <>
          <Presentation className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">{fileName}</p>
          <p className="mt-2 text-sm max-w-md">
            PowerPoint preview is only available in the Projelli desktop app.
            Download the file to view it in PowerPoint or Keynote.
          </p>
          <Button variant="outline" className="mt-4" onClick={handleDownload}>
            Download File
          </Button>
        </>
      )}

      {state.kind === 'no-libreoffice' && (
        <>
          <Presentation className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">{fileName}</p>
          <p
            data-testid="presentation-install-libreoffice"
            className="mt-2 text-sm max-w-md"
          >
            PowerPoint files need LibreOffice to render. Install LibreOffice
            for free at{' '}
            <a
              href="https://libreoffice.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              libreoffice.org
            </a>
            , then reopen this file.
          </p>
          <Button variant="outline" className="mt-4" onClick={handleDownload}>
            Download File
          </Button>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <AlertTriangle className="h-10 w-10 mb-3 text-destructive opacity-70" />
          <p className="text-lg font-medium">Couldn't render {fileName}</p>
          <p
            data-testid="presentation-error"
            className="mt-2 text-sm text-destructive max-w-md"
          >
            {state.message}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={runConversion}>Try again</Button>
            <Button variant="outline" onClick={handleDownload}>
              Download File
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default PresentationViewer;
