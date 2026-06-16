// Document fallback view components extracted from MainPanel.tsx
// (behavior-preserving 3.0 reorg). The lazy-load Suspense fallback and the
// legacy .doc convert-to-.docx fallback. Self-contained; all parent inputs
// arrive via props.

import { useState, useCallback, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { FileType, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';
import { detectLibreOffice, convertDocToDocx } from '@/utils/tauri-commands';
import { downloadFileWithDialog } from './mainPanelHelpers';

export function DocLoadingFallback({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileType className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">{t('layout.main-panel.opening-file', { fileName })}</p>
    </div>
  );
}

export interface DocLegacyFallbackProps {
  tabName: string;
  tabPath: string;
  tabContent: string;
  onFileOpen?: ((path: string, name: string) => Promise<void>) | undefined;
}

/**
 * Fallback UI for legacy `.doc` (pre-2007 binary Word) files.
 *
 * Three branches:
 *   1. Browser (not Tauri): show the plain fallback + a Download button. No
 *      conversion is possible because LibreOffice subprocess calls need the
 *      native host.
 *   2. Tauri + LibreOffice detected: show a primary "Convert to .docx" button.
 *      On click, invoke the Rust command, then open the new .docx tab and
 *      close the current .doc tab (the editor store's openFile handles that
 *      naturally via onFileOpen + user closing the old tab).
 *   3. Tauri + LibreOffice NOT detected: show install instructions pointing
 *      at libreoffice.org, plus the Download button so users can take the
 *      file elsewhere.
 *
 * Detection is cached per-mount in local state. Re-detecting on every remount
 * is cheap (single `which` call) and avoids stale "not installed" results if
 * the user installs LibreOffice while the app is running.
 */
export function DocLegacyFallback({
  tabName,
  tabPath,
  tabContent,
  onFileOpen,
}: DocLegacyFallbackProps) {
  const { t } = useTranslation();
  // Detection state: undefined = still checking, null = not found,
  // string = soffice path.
  const [libreOfficePath, setLibreOfficePath] = useState<string | null | undefined>(
    undefined
  );
  const [conversionState, setConversionState] = useState<
    'idle' | 'loading' | 'error'
  >('idle');
  const [conversionError, setConversionError] = useState<string | null>(null);

  const inTauri = isTauriEnvironment();

  useEffect(() => {
    let cancelled = false;
    // In the browser, don't even try — detectLibreOffice() already
    // short-circuits to null, but this skips the promise entirely.
    if (!inTauri) {
      setLibreOfficePath(null);
      return;
    }
    detectLibreOffice()
      .then((path) => {
        if (!cancelled) setLibreOfficePath(path);
      })
      .catch(() => {
        if (!cancelled) setLibreOfficePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inTauri]);

  const handleConvert = useCallback(async () => {
    setConversionState('loading');
    setConversionError(null);
    try {
      const outputPath = await convertDocToDocx(tabPath);
      // Derive a friendly display name from the path.
      const parts = outputPath.split(/[\\/]/);
      const newName = parts[parts.length - 1] || `${tabName}.docx`;
      // Open the new .docx in a new tab. The old .doc tab stays open (user
      // can close it manually); we don't force-close in case they want the
      // original for reference.
      if (onFileOpen) {
        await onFileOpen(outputPath, newName);
      }
      setConversionState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConversionError(message);
      setConversionState('error');
    }
  }, [tabPath, tabName, onFileOpen]);

  const handleDownload = useCallback(async () => {
    try {
      const response = await fetch(tabContent);
      const blob = await response.blob();
      await downloadFileWithDialog(blob, tabName, blob.type || 'application/msword');
    } catch (err) {
      console.error('[DocLegacyFallback] Download failed:', err);
    }
  }, [tabContent, tabName]);

  // State 1: browser — no conversion possible.
  if (!inTauri) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <FileType className="h-16 w-16 mb-4 opacity-50" />
        <p className="text-lg font-medium">{tabName}</p>
        <p className="mt-2 text-sm max-w-md">
          <Trans
            i18nKey="layout.main-panel.doc-legacy.browser-message"
            components={{ docCode: <code />, docxCode: <code /> }}
          />
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          {t('layout.main-panel.doc-legacy.download-button')}
        </Button>
      </div>
    );
  }

  // Still detecting — avoid flashing the wrong branch.
  if (libreOfficePath === undefined) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <Loader2
          data-testid="doc-convert-loading"
          className="h-10 w-10 mb-3 animate-spin opacity-70"
        />
        <p className="text-sm">{t('layout.main-panel.doc-legacy.checking-libreoffice')}</p>
      </div>
    );
  }

  // State 3: Tauri but LibreOffice not installed.
  if (libreOfficePath === null) {
    return (
      <div
        data-testid="doc-legacy-fallback"
        className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
      >
        <FileType className="h-16 w-16 mb-4 opacity-50" />
        <p className="text-lg font-medium">{tabName}</p>
        <p
          data-testid="doc-convert-install-libreoffice"
          className="mt-2 text-sm max-w-md"
        >
          <Trans
            i18nKey="layout.main-panel.doc-legacy.install-libreoffice"
            components={{
              docCode: <code />,
              libreLink: (
                <a
                  href="https://libreoffice.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                />
              ),
            }}
          />
        </p>
        <Button variant="outline" className="mt-4" onClick={handleDownload}>
          {t('layout.main-panel.doc-legacy.download-button')}
        </Button>
      </div>
    );
  }

  // State 2: Tauri + LibreOffice detected. Show Convert as primary action.
  // During loading, keep the container and swap the content to a spinner.
  return (
    <div
      data-testid="doc-legacy-fallback"
      className="flex-1 flex flex-col items-center justify-center text-muted-foreground h-full px-6 text-center"
    >
      <FileType className="h-16 w-16 mb-4 opacity-50" />
      <p className="text-lg font-medium">{tabName}</p>
      <p className="mt-2 text-sm max-w-md">
        <Trans
          i18nKey="layout.main-panel.doc-legacy.convert-prompt"
          components={{ docCode: <code />, docxCode: <code /> }}
        />
      </p>
      {conversionState === 'loading' ? (
        <div
          data-testid="doc-convert-loading"
          className="mt-4 flex items-center gap-2 text-sm"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('layout.main-panel.doc-legacy.converting')}</span>
        </div>
      ) : conversionState === 'error' ? (
        <div
          data-testid="doc-convert-error"
          className="mt-4 flex flex-col items-center gap-2 max-w-md"
        >
          <p className="text-sm text-destructive">
            {t('layout.main-panel.doc-legacy.conversion-failed', { error: conversionError })}
          </p>
          <div className="flex gap-2">
            <Button onClick={handleConvert} data-testid="doc-convert-button">
              {t('layout.main-panel.doc-legacy.try-again')}
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              {t('layout.main-panel.doc-legacy.download-button')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <Button onClick={handleConvert} data-testid="doc-convert-button">
            {t('layout.main-panel.doc-legacy.convert-button')}
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            {t('layout.main-panel.doc-legacy.download-button')}
          </Button>
        </div>
      )}
    </div>
  );
}
