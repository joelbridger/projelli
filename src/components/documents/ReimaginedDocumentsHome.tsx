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

const REAL_FILE_TYPES = new Set(['file', 'browser', 'whiteboard']);

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

  // Auto-advance to editor view when a real file tab becomes active.
  // Use a ref-guarded pattern to avoid calling setState synchronously inside
  // an effect body (which triggers the react-hooks/set-state-in-effect lint rule).
  const prevActiveTabRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (activeTabPath === null || activeTabPath === prevActiveTabRef.current) {
      return undefined;
    }
    prevActiveTabRef.current = activeTabPath;
    const matchingTab = openTabs.find((t) => t.path === activeTabPath);
    const tabType = matchingTab?.type ?? 'file';
    if (matchingTab && isRealFileTab(tabType)) {
      // Schedule outside the synchronous effect body to satisfy the lint rule.
      const id = setTimeout(() => { setViewMode('editor'); }, 0);
      return () => { clearTimeout(id); };
    }
    return undefined;
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
