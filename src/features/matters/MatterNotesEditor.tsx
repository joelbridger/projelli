/**
 * MatterNotesEditor — live collaborative notes for a shared matter.
 *
 * Binds a CodeMirror 6 editor to `doc.getText('notes')` on a MatterSyncClient's
 * Yjs document via y-codemirror.next's `yCollab` extension. Two clients sharing
 * the same matter key will see each other's edits converge in real time.
 *
 * Fail-closed: when `syncClient` is null (key unavailable, walled, or not yet
 * published) the editor is replaced with a friendly message and no editor
 * mounts — nothing to leak.
 *
 * Disk mirror: on meaningful local change we debounce-write the notes text to
 * `<first folderPath of the matter>/matter-notes.md` via WorkspaceService. This
 * is a READ-ONLY artifact of the synced truth — solo tooling and search still
 * see it. Never write to it directly; the Yjs doc is the source of truth.
 *
 * Presence (remote cursors): y-codemirror.next exposes cursor awareness via
 * `yRemoteSelections` when an `awareness` object is passed to `yCollab`. The
 * MatterSyncClient does NOT expose an awareness channel on its public API (the
 * relay is a dumb pipe for opaque update blobs only — there is no separate
 * awareness broadcast channel). Therefore presence is SKIPPED in this release.
 * Adding it would require either: (a) an awareness channel on the relay (new
 * backend endpoint), or (b) a side-channel in the Yjs doc itself. Neither is
 * in scope for Task 4. Cursor awareness is the named next increment.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import type { MatterSyncClient } from '@/platform/firm/MatterSyncClient';
import type { Matter } from '@/types/matter';
import { useMatterSyncStatus } from '@/stores/matterSyncStore';
import { cn } from '@/lib/utils';

/** How often (ms) we debounce-write the disk mirror. */
const DISK_MIRROR_DEBOUNCE_MS = 2000;

interface MatterNotesEditorProps {
  matter: Matter;
  /** The running sync client. Null triggers the fail-closed render. */
  syncClient: MatterSyncClient | null;
  /**
   * WorkspaceService instance used to mirror notes to disk. If omitted the
   * disk mirror is skipped (e.g. in tests without a workspace).
   */
  workspaceService?: { writeFile: (path: string, content: string) => Promise<void> } | null;
  className?: string;
}

/** Label the sync status badge for the user (i18n key suffix). */
function statusI18nKey(
  status: ReturnType<typeof useMatterSyncStatus>,
): string {
  switch (status) {
    case 'live': return 'status-live';
    case 'connecting': return 'status-connecting';
    case 'catching-up': return 'status-catching-up';
    case 'offline': return 'status-offline';
    case 'error': return 'status-error';
    default: return 'status-idle';
  }
}

function statusDotClass(
  status: ReturnType<typeof useMatterSyncStatus>,
): string {
  switch (status) {
    case 'live': return 'bg-green-500';
    case 'connecting':
    case 'catching-up': return 'bg-yellow-400';
    case 'offline': return 'bg-gray-400';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-300';
  }
}

export function MatterNotesEditor({
  matter,
  syncClient,
  workspaceService,
  className,
}: MatterNotesEditorProps) {
  const { t } = useTranslation();
  const syncStatus = useMatterSyncStatus(matter.id);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const diskMirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a debounced write of the notes text to the first matter folder.
  const scheduleDiskMirror = useCallback(
    (text: string) => {
      if (!workspaceService) return;
      const folder = matter.folderPaths[0];
      if (!folder) return;
      if (diskMirrorTimerRef.current) clearTimeout(diskMirrorTimerRef.current);
      diskMirrorTimerRef.current = setTimeout(async () => {
        try {
          await workspaceService.writeFile(`${folder}/matter-notes.md`, text);
        } catch (err) {
          // Non-fatal: the Yjs doc is the source of truth.
          console.warn('[MatterNotesEditor] disk mirror write failed:', err);
        }
      }, DISK_MIRROR_DEBOUNCE_MS);
    },
    [workspaceService, matter.folderPaths],
  );

  useEffect(() => {
    if (!editorContainerRef.current || !syncClient) return;
    // Already mounted (StrictMode double-effect).
    if (editorViewRef.current) return;

    const yText = syncClient.doc.getText('notes');

    // Light theme matching the rest of the markdown editor. We keep it minimal:
    // no line numbers (notes are short), same font size + monospace as MarkdownEditor.
    const lightTheme = EditorView.theme(
      {
        '&': {
          height: '100%',
          fontSize: '14px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          background: '#ffffff',
        },
        '.cm-content': {
          padding: '12px 16px',
          minHeight: '100%',
          caretColor: '#1a1a1a',
          color: '#1a1a1a',
        },
        '.cm-focused': { outline: 'none' },
        '.cm-editor': { height: '100%' },
        '.cm-scroller': { overflow: 'auto', height: '100%' },
        '.cm-gutters': { background: '#f9fafb', borderRight: '1px solid #e5e7eb', color: '#9ca3af' },
        '.cm-cursor': { borderLeftColor: '#1a1a1a' },
        '.cm-selectionBackground': { background: '#dbeafe !important' },
        '.cm-activeLineGutter': { background: '#f3f4f6' },
      },
      { dark: false },
    );

    // y-codemirror.next: yCollab with null awareness (no presence channel).
    // Passing `false` for undoManager so UndoManager doesn't interfere with
    // the app's own undo stack on close.
    const collabExtension = yCollab(yText, null, { undoManager: false });

    // Mirror text to disk on every local doc update (debounced).
    const diskMirrorExtension = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        scheduleDiskMirror(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle),
        markdown({ base: markdownLanguage }),
        lightTheme,
        collabExtension,
        diskMirrorExtension,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });
    editorViewRef.current = view;

    return () => {
      if (diskMirrorTimerRef.current) clearTimeout(diskMirrorTimerRef.current);
      view.destroy();
      editorViewRef.current = null;
    };
  }, [syncClient, scheduleDiskMirror]);

  // Fail-closed: no sync client means no access.
  if (!syncClient) {
    return (
      <div
        data-testid="matter-notes-no-access"
        className={cn('flex flex-col items-center justify-center h-full text-center px-6', className)}
      >
        <div className="text-4xl mb-3 opacity-40">&#128274;</div>
        <p className="text-sm font-medium text-foreground/80 mb-1">
          {t('matter.notes.no-access')}
        </p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {t('matter.notes.no-access-hint')}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="matter-notes-editor"
      className={cn('flex flex-col h-full bg-white', className)}
    >
      {/* Header: matter name + sync status badge + subtitle */}
      <div className="flex items-start justify-between px-4 py-3 border-b bg-gray-50">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 truncate">
              {t('matter.notes.title')}
            </h2>
            {/* Sync status badge */}
            <span
              data-testid="matter-notes-sync-badge"
              className="flex items-center gap-1 text-xs text-gray-500 shrink-0"
              aria-label={t(`matter.notes.${statusI18nKey(syncStatus)}`)}
            >
              <span className={cn('inline-block w-2 h-2 rounded-full', statusDotClass(syncStatus))} />
              {t(`matter.notes.${statusI18nKey(syncStatus)}`)}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('matter.notes.subtitle')}
          </p>
        </div>
      </div>

      {/* Editor surface */}
      <div
        ref={editorContainerRef}
        data-testid="matter-notes-cm-editor"
        className="flex-1 overflow-hidden"
        aria-label={`${matter.name} shared notes`}
      />
    </div>
  );
}
