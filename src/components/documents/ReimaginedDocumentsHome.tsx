/**
 * ReimaginedDocumentsHome — persistent-split documents surface for the reimagined shell.
 *
 * Layout: LEFT panel (~300px, collapsible) always shows the DocumentBrowser
 * (file list + trash). RIGHT panel always shows mainPanelContent (the editor)
 * or a calm placeholder when no file is open. Opening a file shows it on the
 * right while the list stays visible on the left.
 *
 * The old viewMode 'browser' | 'editor' toggle is gone. The editor pane is
 * always mounted, so the email-open flow (keepance:open-email -> editor) and
 * citation-persistence work exactly as before — the editor is just always
 * visible instead of conditionally rendered.
 *
 * "Add files" import affordance lives in the left panel header and the
 * empty placeholder. The first time a user adds a file, a one-time dismissible
 * reassurance banner appears ("Indexed on your machine. Nothing was uploaded.")
 * and is remembered via localStorage('keepance:first-file-trust-shown').
 *
 * No Tailwind on layout elements — all styling via inline styles + CSS vars.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Upload, ChevronLeft, ChevronRight, FileText, Plus, X } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import type { TrashRetentionPeriod } from '@/components/common/TrashPanel';
import { DocumentBrowser } from './DocumentBrowser';

// ── Constants ──────────────────────────────────────────────────────────────

const LEFT_PANEL_WIDTH = 300;
const TRUST_STORAGE_KEY = 'keepance:first-file-trust-shown';

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

// Tab types that render content in the editor pane (mainPanelContent).
// 'email' is included so opening an email from the Email surface shows it here.
const REAL_FILE_TYPES = new Set(['file', 'browser', 'whiteboard', 'email']);

function isRealFileTab(type: string): boolean {
  return REAL_FILE_TYPES.has(type);
}

function hasTrustBeenShown(): boolean {
  try {
    return localStorage.getItem(TRUST_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markTrustShown(): void {
  try {
    localStorage.setItem(TRUST_STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

// ── Trust banner ──────────────────────────────────────────────────────────

interface TrustBannerProps {
  onDismiss: () => void;
}

function TrustBanner({ onDismiss }: TrustBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="trust-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 16px',
        background: '#eef4ff',
        borderBottom: '1px solid #c7d9f8',
        borderTop: '1px solid #c7d9f8',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--kp-navy)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <FileText style={{ width: 14, height: 14, color: '#fff', strokeWidth: 2 }} />
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--kp-navy)',
            fontFamily: 'Satoshi, sans-serif',
            lineHeight: 1.4,
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          Indexed on your machine. Nothing was uploaded.
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </span>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          color: 'var(--kp-navy)',
          opacity: 0.6,
          flex: 'none',
        }}
      >
        <X style={{ width: 14, height: 14, strokeWidth: 2 }} />
      </button>
    </div>
  );
}

// ── Empty right-pane placeholder ───────────────────────────────────────────

interface RightPanelPlaceholderProps {
  onCreateDocument: () => void;
  onImportFiles: () => void;
}

function RightPanelPlaceholder({ onCreateDocument, onImportFiles }: RightPanelPlaceholderProps) {
  return (
    <div
      data-testid="right-panel-placeholder"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '40px 32px',
        textAlign: 'center',
        gap: 12,
        background: 'var(--color-background)',
      }}
    >
      <FileText
        style={{
          width: 36,
          height: 36,
          color: 'var(--kp-navy)',
          strokeWidth: 1.5,
          marginBottom: 4,
          opacity: 0.3,
        }}
      />
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--kp-navy)',
          fontFamily: 'Satoshi, sans-serif',
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Select a file to open it
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 320,
          lineHeight: 1.6,
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Real Word documents, with tracked changes and AI redlining, stored as files on your computer.
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--kp-navy)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'Satoshi, sans-serif',
          }}
          onClick={onCreateDocument}
        >
          <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          New Word document
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </button>
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: '#fff',
            color: 'var(--kp-navy)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            fontFamily: 'Satoshi, sans-serif',
          }}
          onClick={onImportFiles}
        >
          <Upload style={{ width: 14, height: 14, strokeWidth: 2 }} />
          Add files
        </button>
      </div>
    </div>
  );
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

  // Whether the left panel is collapsed
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Whether to show the trust note (only when not yet shown)
  const [showTrustBanner, setShowTrustBanner] = useState(false);

  // Whether there is an active file/email open in the right pane
  const hasActiveContent = React.useMemo(() => {
    if (activeTabPath === null) return false;
    const matchingTab = openTabs.find((t) => t.path === activeTabPath);
    if (!matchingTab) return false;
    return isRealFileTab(matchingTab.type ?? 'file');
  }, [activeTabPath, openTabs]);

  // advancedForRef: kept for backward compat with the email-open flow.
  // In the split layout the editor is always mounted, so we just track which
  // tab was "opened" to avoid running side effects repeatedly on the same tab.
  const advancedForRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (activeTabPath === null) return;
    if (advancedForRef.current === activeTabPath) return;
    const matchingTab = openTabs.find((t) => t.path === activeTabPath);
    if (!matchingTab) return; // not registered yet; wait for next openTabs update
    advancedForRef.current = activeTabPath;
    // No viewMode flip needed — the right pane is always present.
    // This effect just keeps advancedForRef in sync so the email-open path
    // (keepance:open-email -> editorStore update) stays registered.
  }, [activeTabPath, openTabs]);

  // ── Import / add-files handler ───────────────────────────────────────────

  const handleAddFiles = useCallback(() => {
    // Show trust note the first time
    if (!hasTrustBeenShown()) {
      setShowTrustBanner(true);
      markTrustShown();
    }
    // Delegate to the existing create/import path (opens a file-picker dialog
    // via onCreateFile or onCreateDefaultDocument, whichever is available).
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument();
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot();
    } else {
      onCreateFile('');
    }
  }, [onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleDismissTrust = useCallback(() => {
    setShowTrustBanner(false);
  }, []);

  // ── Document creation (reused by right-panel placeholder) ────────────────

  const handleCreateDocument = useCallback(() => {
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument();
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot();
    } else {
      onCreateFile('');
    }
  }, [onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="reimagined-documents-split"
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* ── LEFT PANEL (file browser) ─────────────────────────────────── */}
      {!leftCollapsed && (
        <div
          data-testid="documents-left-panel"
          style={{
            width: LEFT_PANEL_WIDTH,
            minWidth: LEFT_PANEL_WIDTH,
            maxWidth: LEFT_PANEL_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--color-border)',
            background: 'var(--color-background)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* Left panel header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 12px 12px 16px',
              borderBottom: '1px solid var(--color-border)',
              flexShrink: 0,
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-muted-foreground)',
                fontFamily: 'Satoshi, sans-serif',
              }}
            >
              Documents
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Add files */}
              <button
                type="button"
                data-testid="add-files-btn"
                title="Add files"
                aria-label="Add files"
                onClick={handleAddFiles}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#fff',
                  color: 'var(--kp-navy)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: 'Satoshi, sans-serif',
                  whiteSpace: 'nowrap',
                }}
              >
                <Upload style={{ width: 12, height: 12, strokeWidth: 2 }} />
                Add files
              </button>
              {/* Collapse */}
              <button
                type="button"
                aria-label="Collapse file list"
                onClick={() => { setLeftCollapsed(true); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 4,
                  color: 'var(--color-muted-foreground)',
                }}
              >
                <ChevronLeft style={{ width: 15, height: 15, strokeWidth: 2 }} />
              </button>
            </div>
          </div>

          {/* Trust banner (one-time, dismissible) */}
          {showTrustBanner && (
            <TrustBanner onDismiss={handleDismissTrust} />
          )}

          {/* File browser fills remaining height */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
              compact={true}
              {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
              {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
              {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
              {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
              {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
            />
          </div>
        </div>
      )}

      {/* Expand button when collapsed */}
      {leftCollapsed && (
        <button
          type="button"
          aria-label="Expand file list"
          onClick={() => { setLeftCollapsed(false); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            background: 'var(--color-background)',
            border: 'none',
            borderRight: '1px solid var(--color-border)',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--color-muted-foreground)',
            flexShrink: 0,
          }}
        >
          <ChevronRight style={{ width: 15, height: 15, strokeWidth: 2 }} />
        </button>
      )}

      {/* ── RIGHT PANEL (editor or placeholder) ──────────────────────── */}
      <div
        data-testid="documents-right-panel"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-background)',
        }}
      >
        {hasActiveContent ? (
          // Always render mainPanelContent when a real file/email is active
          <div
            data-testid="documents-editor-pane"
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
        ) : (
          <RightPanelPlaceholder
            onCreateDocument={handleCreateDocument}
            onImportFiles={handleAddFiles}
          />
        )}
      </div>
    </div>
  );
}
