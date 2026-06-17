// Binary Version History Panel (WS-A / A5)
//
// The version-history surface for files snapshotted on disk by
// `BinaryVersionService` — the canonical `.docx` documents and the text formats
// that now also keep history on disk. It lists snapshots (timestamp, author,
// size), restores a chosen snapshot over the current file (which itself becomes
// a new version, so nothing is lost), and shows a diff against the current file.
//
// DIFF: a byte diff of two `.docx` packages is meaningless, so for `.docx` we
// extract PLAIN TEXT from each version via the in-house engine and feed it to
// the shared line-based `DiffViewer`. Structural / track-change-level diffing is
// a deliberate follow-up. For text formats we decode the snapshot bytes as UTF-8
// and diff directly. LIGHT THEME ONLY.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
  Sparkles,
  User,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DiffViewer } from '@/features/documents/editor/DiffViewer';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  getBinaryVersionService,
  type BinaryVersionEntry,
  type VersionFS,
} from '@/features/documents/versioning';
import { extractDocxTextFromPath, canDiffDocx } from '@/utils/docx-version-diff';

interface BinaryVersionHistoryPanelProps {
  /** Absolute on-disk path of the file (the tab path). */
  filePath: string;
  fileName: string;
  /** The live workspace FS (WorkspaceService satisfies this). */
  fs: VersionFS | null;
  /**
   * Called after a successful restore so the parent can reload the editor with
   * the restored content. The bytes are the restored file's bytes.
   */
  onRestored?: (bytes: ArrayBuffer) => void;
  onClose: () => void;
  className?: string;
}

function isDocxPath(path: string): boolean {
  return path.toLowerCase().endsWith('.docx');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(new Uint8Array(buf));
}

export function BinaryVersionHistoryPanel({
  filePath,
  fileName,
  fs,
  onRestored,
  onClose,
  className,
}: BinaryVersionHistoryPanelProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<BinaryVersionEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ original: string; modified: string } | null>(
    null,
  );
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const docx = isDocxPath(filePath);

  const refresh = useCallback(async () => {
    const vs = getBinaryVersionService(fs);
    if (!vs) {
      setVersions([]);
      return;
    }
    const list = await vs.listVersions(filePath);
    setVersions(list);
  }, [fs, filePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Build the diff (selected version vs current file) when a version is picked.
  const handleSelect = useCallback(
    async (entry: BinaryVersionEntry) => {
      setSelectedId(entry.id);
      setDiff(null);
      setDiffError(null);
      const vs = getBinaryVersionService(fs);
      if (!vs) return;
      setDiffLoading(true);
      try {
        if (docx) {
          // .docx: extract plain text from both versions via the engine.
          if (!canDiffDocx()) {
            setDiffError(t('version.history.docx-diff-desktop-only'));
            return;
          }
          const snapPath = await vs.snapshotAbsolutePath(filePath, entry.id);
          const [original, modified] = await Promise.all([
            extractDocxTextFromPath(snapPath),
            extractDocxTextFromPath(filePath),
          ]);
          setDiff({ original, modified });
        } else {
          // Text: decode snapshot + current bytes as UTF-8.
          const snapBytes = await vs.readSnapshotBytes(filePath, entry.id);
          const currentBytes = await fs!.readFileBinary(filePath);
          setDiff({
            original: decodeUtf8(snapBytes),
            modified: decodeUtf8(currentBytes),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDiffError(message);
      } finally {
        setDiffLoading(false);
      }
    },
    [fs, filePath, docx, t],
  );

  const handleRestore = useCallback(
    async (entry: BinaryVersionEntry) => {
      const vs = getBinaryVersionService(fs);
      if (!vs) return;
      const confirmed = await confirm(
        t('version.history.restore-confirm', { date: formatDate(entry.timestamp) }),
        {
          title: t('version.history.restore-title'),
          confirmLabel: t('version.history.restore-action'),
        },
      );
      if (!confirmed) return;
      setRestoring(true);
      try {
        const bytes = await vs.restoreVersion(filePath, entry.id);
        await refresh();
        onRestored?.(bytes);
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDiffError(message);
      } finally {
        setRestoring(false);
      }
    },
    [fs, filePath, confirm, refresh, onRestored, onClose, t],
  );

  return (
    <div
      data-testid="binary-version-history"
      className={cn('flex h-full flex-col border-l bg-background', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-[#0A2540]" />
          <div>
            <h2 className="text-lg font-semibold">
              {t('version.history.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{fileName}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Version list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-muted-foreground">
            <History className="mb-4 h-12 w-12 opacity-50" />
            <p className="text-center">{t('version.history.empty-title')}</p>
            <p className="mt-2 text-center text-sm">
              {t('version.history.empty-description')}
            </p>
          </div>
        ) : (
          <ul data-testid="binary-version-list" className="space-y-2 p-4">
            {versions.map((v, index) => (
              <li
                key={v.id}
                data-testid="binary-version-row"
                data-version-id={v.id}
                data-author={v.author}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/50',
                  selectedId === v.id && 'border-[#0A2540] bg-[#0A2540]/5',
                )}
                onClick={() => void handleSelect(v)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {index === 0
                          ? t('version.history.latest')
                          : `${t('version.history.version')} ${versions.length - index}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(v.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span
                        data-testid="binary-version-author"
                        className="inline-flex items-center gap-1"
                      >
                        {v.author === 'ai' ? (
                          <>
                            <Sparkles className="h-3 w-3 text-[#0A2540]" />
                            {t('version.history.author-ai')}
                          </>
                        ) : (
                          <>
                            <User className="h-3 w-3" />
                            {t('version.history.author-user')}
                          </>
                        )}
                      </span>
                      <span>{formatSize(v.size)}</span>
                      {v.message && (
                        <span className="truncate italic">{v.message}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    data-testid="binary-version-restore"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={restoring}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRestore(v);
                    }}
                    title={t('version.history.restore-action')}
                    aria-label={t('version.history.restore-action')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Diff preview */}
      {selectedId && (
        <div className="flex max-h-96 flex-col border-t bg-muted/30">
          <div className="flex items-center justify-between border-b bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t('version.history.preview')}
              </span>
            </div>
            {(() => {
              const sel = versions.find((v) => v.id === selectedId);
              if (!sel) return null;
              return (
                <Button
                  variant="default"
                  size="sm"
                  className="bg-[#0A2540] hover:bg-[#0A2540]/90"
                  disabled={restoring}
                  onClick={() => void handleRestore(sel)}
                >
                  {restoring ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  )}
                  {t('version.history.restore-action')}
                </Button>
              );
            })()}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {diffLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('version.history.diff-loading')}
              </div>
            ) : diffError ? (
              <p
                data-testid="binary-version-diff-error"
                className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                {diffError}
              </p>
            ) : diff ? (
              <>
                {docx && (
                  <p className="mb-2 rounded bg-[#0A2540]/5 px-2 py-1 text-[11px] text-[#0A2540]">
                    {t('version.history.docx-text-diff-note')}
                  </p>
                )}
                <DiffViewer
                  originalContent={diff.original}
                  modifiedContent={diff.modified}
                  originalLabel={t('version.history.this-version')}
                  modifiedLabel={t('version.history.current')}
                  showLineNumbers
                  viewMode="unified"
                />
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Footer */}
      {versions.length > 0 && (
        <div className="border-t bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">
            {versions.length}{' '}
            {versions.length === 1
              ? t('version.history.version')
              : t('version.history.versions')}
          </div>
        </div>
      )}

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default BinaryVersionHistoryPanel;
