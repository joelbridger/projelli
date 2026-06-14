/**
 * ReimaginedDocumentsHome — full-page documents surface for the reimagined shell.
 *
 * Orchestrates two views:
 *  - 'browser': full-width DocumentBrowser (file tree + trash)
 *  - 'editor': full-width mainPanelContent with a thin "← Documents" header
 *
 * viewMode auto-advances to 'editor' when a real file tab becomes active.
 * Navigating back via the header sets viewMode to 'browser' without closing tabs.
 *
 * No Tailwind on layout elements — all styling via inline styles + CSS vars.
 */

import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import type { TrashRetentionPeriod } from '@/components/common/TrashPanel';
import { DocumentBrowser } from './DocumentBrowser';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ReimaginedDocumentsHomeProps {
  mainPanelContent: React.ReactNode;
  // Trash handlers (from App.tsx trashContent wiring)
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  retentionPeriod?: TrashRetentionPeriod;
  customRetentionDays?: number;
  onRetentionChange?: (period: TrashRetentionPeriod, customDays?: number) => void;
  // File operation handlers (from App.tsx FileTree wiring)
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload: (path: string, name: string) => void;
  // Optional: new-document shortcuts
  onCreateDefaultDocument?: () => void;
  onCreateDocxAtRoot?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Tab types that render full-screen in the editor pane (mainPanelContent) and
// should therefore auto-advance Documents from the browser to the editor view.
// 'email' is included so opening an email from the Email surface actually shows
// it (EmailViewer renders inside mainPanelContent) instead of the empty browser.
const REAL_FILE_TYPES = new Set(['file', 'browser', 'whiteboard', 'email']);

function isRealFileTab(type: string): boolean {
  return REAL_FILE_TYPES.has(type);
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedDocumentsHome({
  mainPanelContent,
  trashItems,
  trashStats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod,
  customRetentionDays,
  onRetentionChange,
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  onCreateDefaultDocument,
  onCreateDocxAtRoot,
}: ReimaginedDocumentsHomeProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);

  const [viewMode, setViewMode] = useState<'browser' | 'editor'>('browser');

  // Auto-advance to the editor view when a NEW real-file or email tab becomes
  // active, so opening a file or an email actually shows it. We remember the
  // tab we last advanced for in a ref so a later openTabs change for the SAME
  // tab (content load after open, autosave) does not re-trigger — that previously
  // cancelled a deferred setState and left the user stranded on the empty browser
  // — and so the user can click "Documents" to return to the browser and stay there.
  const advancedForRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (activeTabPath === null) return;
    if (advancedForRef.current === activeTabPath) return;
    const matchingTab = openTabs.find((t) => t.path === activeTabPath);
    if (!matchingTab) return; // not registered yet; wait for the next openTabs update
    advancedForRef.current = activeTabPath;
    if (isRealFileTab(matchingTab.type ?? 'file')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode('editor');
    }
  }, [activeTabPath, openTabs]);

  // ── Browser view ──────────────────────────────────────────────────────

  if (viewMode === 'browser') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--color-background)',
          fontFamily: 'Satoshi, sans-serif',
          overflowY: 'auto',
        }}
      >
        <DocumentBrowser
          onFileOpen={onFileOpen}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
          onDownload={onDownload}
          trashItems={trashItems}
          trashStats={trashStats}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          onEmptyTrash={onEmptyTrash}
          {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
          {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
          {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
          {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
          {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
        />
      </div>
    );
  }

  // ── Editor view ──────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Thin "back" bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          background: 'var(--color-background)',
        }}
      >
        <button
          type="button"
          onClick={() => { setViewMode('browser'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--kp-navy)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'Satoshi, sans-serif',
          }}
        >
          <ChevronLeft style={{ width: 16, height: 16, strokeWidth: 2 }} />
          Documents
        </button>
      </div>

      {/* Main editor content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {mainPanelContent}
      </div>
    </div>
  );
}
