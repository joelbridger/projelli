// DOCX Viewer
// Read-only preview for `.docx` files using docx-preview.
//
// docx-preview injects its own document-scoped styles (e.g. .docx-wrapper, page
// classes, etc.). To keep them from bleeding into the rest of the app — and to
// keep our app styles from leaking into the rendered Word document — we mount
// the renderer inside a Shadow DOM. The shadow root is fully isolated, which
// is the cleanest way to scope CSS while still letting docx-preview render
// faithfully. (Alternative: an iframe, but that requires more plumbing for
// images and base64 URLs, and breaks selection / Cmd-F across the document.)

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileType, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { openExternal } from '@/platform/utils/openExternal';
import { parseDocxForPreview, renderDocxPreview } from '@/platform/utils/docx-io';

interface DocxViewerProps {
  src: string;
  fileName: string;
  className?: string;
}

export function DocxViewer({ src, fileName, className }: DocxViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    setError(null);
    setIsLoading(true);

    // Attach (or reuse) a shadow root so docx-preview's styles stay scoped.
    const shadow: ShadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    // Wipe any prior render by removing children one-by-one (safer than
    // setting innerHTML to '' — same effect, no XSS-shaped tooling alarms).
    while (shadow.firstChild) {
      shadow.removeChild(shadow.firstChild);
    }
    const container = document.createElement('div');
    container.style.padding = '24px';
    container.style.background = '#f3f4f6'; // matches muted/40 — page tray look
    container.style.minHeight = '100%';
    shadow.appendChild(container);

    void (async () => {
      try {
        const bytes = await parseDocxForPreview(src);
        if (cancelled) return;
        await renderDocxPreview(bytes, container);
        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error.';
        setError(message);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div
      data-testid="docx-viewer"
      className={cn('flex h-full flex-col bg-background', className)}
    >
      {error ? (
        <DocxError fileName={fileName} message={error} />
      ) : (
        <>
          {isLoading && <DocxSkeleton fileName={fileName} />}
          {/* The shadow-root host. `overflow-auto` here gives us in-pane
              scrolling so long documents don't push the whole app around. */}
          <div
            ref={hostRef}
            className={cn('flex-1 overflow-auto', isLoading && 'invisible')}
          />
        </>
      )}
    </div>
  );
}

function DocxSkeleton({ fileName }: { fileName: string }) {
  return (
    <div
      data-testid="docx-loading"
      className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
    >
      <FileType className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">Opening {fileName}...</p>
    </div>
  );
}

function DocxError({ fileName, message }: { fileName: string; message: string }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="docx-error"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
    >
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div>
        <p className="text-sm font-medium text-foreground">{t('media.docx-viewer.could-not-open', { fileName })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      {/* TODO: hook this up to a Tauri command that opens the file in the
          system's default app once the workspace exposes the on-disk path. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void openExternal('https://support.microsoft.com/word');
        }}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        {t('media.docx-viewer.open-native')}
      </Button>
    </div>
  );
}

export default DocxViewer;
