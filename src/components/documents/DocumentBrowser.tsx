/**
 * DocumentBrowser — full-page file browser for the Documents surface.
 *
 * Renders a Matters-style table card with drill-down folder navigation,
 * search, breadcrumbs, and a Files | Trash toggle. When the trash view
 * is active it delegates entirely to the existing TrashPanel component.
 */

import React, { useState } from 'react';
import {
  FileText,
  Plus,
  ChevronRight,
  Search,
} from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { TrashPanel } from '@/components/common/TrashPanel';
import type { TrashRetentionPeriod } from '@/components/common/TrashPanel';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import type { FileNode } from '@/types/workspace';
import { DocumentBrowserRow } from './DocumentBrowserRow';

// ── Helpers ────────────────────────────────────────────────────────────────


// ── Sub-components ──────────────────────────────────────────────────────────

interface BreadcrumbSegment {
  label: string;
  path: string | null;
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (path: string | null) => void;
}

function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
  if (segments.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '10px 20px 0',
        flexWrap: 'wrap',
      }}
    >
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        return (
          <React.Fragment key={seg.path ?? '__root__'}>
            {idx > 0 && (
              <ChevronRight
                style={{
                  width: 13,
                  height: 13,
                  color: 'var(--color-muted-foreground)',
                  strokeWidth: 2,
                  flex: 'none',
                }}
              />
            )}
            <button
              type="button"
              onClick={() => { onNavigate(seg.path); }}
              style={{
                fontSize: 13,
                fontWeight: isLast ? 600 : 400,
                color: isLast ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'Satoshi, sans-serif',
              }}
            >
              {seg.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface TableHeaderProps {
  colTemplate: string;
}

function TableHeader({ colTemplate }: TableHeaderProps) {
  const cellStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-muted-foreground)',
    padding: '10px 0',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: colTemplate,
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ ...cellStyle, paddingLeft: 24 + 8 }}>Name</div>
      <div style={cellStyle}>Type</div>
      <div style={cellStyle}>Modified</div>
      <div style={cellStyle}>Size</div>
      <div style={cellStyle} />
    </div>
  );
}

interface EmptyStateProps {
  onCreateDocument?: () => void;
  onCreateFolder?: () => void;
}

function EmptyState({ onCreateDocument, onCreateFolder }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <FileText
        style={{
          width: 36,
          height: 36,
          color: 'var(--kp-navy)',
          strokeWidth: 1.5,
          marginBottom: 4,
          opacity: 0.35,
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
        Your workspace is ready
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 340,
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
          onClick={() => {
            onCreateDocument?.();
          }}
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
          onClick={() => {
            onCreateFolder?.();
          }}
        >
          <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
          New folder
        </button>
      </div>
    </div>
  );
}

function EmptySearchState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        gap: 8,
      }}
    >
      <Search
        style={{
          width: 28,
          height: 28,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.5,
          marginBottom: 4,
        }}
      />
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--kp-navy)',
          fontFamily: 'Satoshi, sans-serif',
        }}
      >
        No results
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        No files match your search. Try a different name.
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface DocumentBrowserProps {
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload: (path: string, name: string) => void;
  onCreateDefaultDocument?: () => void;
  onCreateDocxAtRoot?: () => void;
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  retentionPeriod?: TrashRetentionPeriod;
  customRetentionDays?: number;
  onRetentionChange?: (period: TrashRetentionPeriod, customDays?: number) => void;
}

// ── Main export ────────────────────────────────────────────────────────────

export function DocumentBrowser({
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onDownload,
  onCreateDefaultDocument,
  onCreateDocxAtRoot,
  trashItems,
  trashStats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod,
  customRetentionDays,
  onRetentionChange,
}: DocumentBrowserProps) {
  const fileTree = useWorkspaceStore((s) => s.fileTree);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);

  const [activeView, setActiveView] = useState<'files' | 'trash'>('files');
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const COL_TEMPLATE = '1fr 80px 130px 90px 80px';

  // ── Determine which nodes to show ──────────────────────────────────────

  function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.type === 'folder' && node.children) {
        const found = findNodeByPath(node.children, targetPath);
        if (found !== null) return found;
      }
    }
    return null;
  }

  let currentNodes: FileNode[] = [];
  if (currentFolderPath === null) {
    currentNodes = fileTree;
  } else {
    const folderNode = findNodeByPath(fileTree, currentFolderPath);
    currentNodes = folderNode?.children ?? [];
  }

  // Sort: folders first, then files, each group alphabetically.
  const sortedNodes = [...currentNodes].sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });

  // Apply search filter.
  const filteredNodes = searchQuery.trim()
    ? sortedNodes.filter((n) =>
        n.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedNodes;

  // ── Breadcrumb segments ────────────────────────────────────────────────

  function buildBreadcrumbs(): BreadcrumbSegment[] {
    const segments: BreadcrumbSegment[] = [
      { label: 'All files', path: null },
    ];
    if (currentFolderPath === null) return [];

    // Walk the tree to collect ancestor segments.
    function collectAncestors(
      nodes: FileNode[],
      targetPath: string,
      accumulated: BreadcrumbSegment[],
    ): boolean {
      for (const node of nodes) {
        if (node.type !== 'folder') continue;
        const next = [...accumulated, { label: node.name, path: node.path }];
        if (node.path === targetPath) {
          segments.push(...next);
          return true;
        }
        if (node.children && collectAncestors(node.children, targetPath, next)) {
          return true;
        }
      }
      return false;
    }

    collectAncestors(fileTree, currentFolderPath, []);
    return segments;
  }

  const breadcrumbs = buildBreadcrumbs();

  // ── Derived values ─────────────────────────────────────────────────────

  const totalFileCount = (function count(nodes: FileNode[]): number {
    let total = 0;
    for (const n of nodes) {
      if (n.type === 'file') total += 1;
      else if (n.children) total += count(n.children);
    }
    return total;
  })(fileTree);

  const trashBadgeCount = trashStats.itemCount;

  const subtitleText =
    currentFolderPath !== null
      ? (findNodeByPath(fileTree, currentFolderPath)?.name ?? 'Folder')
      : totalFileCount === 0
        ? 'No documents yet'
        : totalFileCount === 1
          ? '1 document'
          : `${String(totalFileCount)} documents`;

  // ── File handlers ──────────────────────────────────────────────────────

  function handleNodeOpen(node: FileNode) {
    if (node.type === 'folder') {
      setCurrentFolderPath(node.path);
      setSearchQuery('');
    } else {
      void onFileOpen(node.path, node.name);
    }
  }

  function handleCreateDocument() {
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument();
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot();
    } else {
      onCreateFile(currentFolderPath ?? rootPath ?? '');
    }
  }

  function handleCreateFolder() {
    onCreateFolder(currentFolderPath ?? rootPath ?? '');
  }

  // ── Is the node the active tab? ────────────────────────────────────────

  function isNodeActive(node: FileNode): boolean {
    if (node.type === 'folder') return false;
    const isActiveFile =
      node.path === activeTabPath &&
      openTabs.some((t) => {
        const tabType = t.type ?? 'file';
        return (
          t.path === activeTabPath &&
          tabType !== 'ai-assistant' &&
          tabType !== 'workflow-execution' &&
          tabType !== 'email'
        );
      });
    return isActiveFile;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  const segmentBtnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRadius: 0,
    transition: 'background 0.1s, color 0.1s',
    fontFamily: 'Satoshi, sans-serif',
    whiteSpace: 'nowrap',
  };

  const segmentActive: React.CSSProperties = {
    background: 'var(--kp-navy)',
    color: '#fff',
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  };

  const segmentInactive: React.CSSProperties = {
    background: '#fff',
    color: 'var(--color-muted-foreground)',
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  };

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
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '28px 24px 20px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 6,
            }}
          >
            Documents
          </div>
          <h1
            style={{
              margin: '0 0 4px',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--kp-navy)',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              fontFamily: 'Satoshi, sans-serif',
            }}
          >
            Documents
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.4,
            }}
          >
            {subtitleText}
          </p>
        </div>

        {/* Files | Trash toggle */}
        <div
          style={{
            display: 'inline-flex',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--color-border)',
            flex: 'none',
          }}
        >
          <button
            type="button"
            style={{
              ...segmentBtnBase,
              ...(activeView === 'files' ? segmentActive : segmentInactive),
              borderRight: '1px solid var(--color-border)',
              borderTop: 'none',
              borderBottom: 'none',
              borderLeft: 'none',
            }}
            onClick={() => { setActiveView('files'); }}
          >
            Files
          </button>
          <button
            type="button"
            style={{
              ...segmentBtnBase,
              ...(activeView === 'trash' ? segmentActive : segmentInactive),
              display: 'inline-flex',
              gap: 6,
            }}
            onClick={() => { setActiveView('trash'); }}
          >
            Trash
            {trashBadgeCount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  fontSize: 10,
                  fontWeight: 700,
                  background:
                    activeView === 'trash'
                      ? 'rgba(255,255,255,0.25)'
                      : 'rgba(10,37,64,0.12)',
                  color: activeView === 'trash' ? '#fff' : 'var(--kp-navy)',
                  padding: '0 4px',
                }}
              >
                {String(trashBadgeCount)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Action bar + search (files view only) */}
      {activeView === 'files' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 24px 16px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--kp-navy)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'Satoshi, sans-serif',
            }}
            onClick={handleCreateDocument}
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
              padding: '7px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              background: '#fff',
              color: 'var(--kp-navy)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'Satoshi, sans-serif',
            }}
            onClick={handleCreateFolder}
          >
            <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
            New folder
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginLeft: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '5px 10px',
              background: '#fff',
            }}
          >
            <Search
              style={{
                width: 13,
                height: 13,
                color: 'var(--color-muted-foreground)',
                strokeWidth: 2,
                flex: 'none',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              placeholder="Search files..."
              style={{
                fontSize: 13,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--color-foreground)',
                width: 180,
                fontFamily: 'Satoshi, sans-serif',
              }}
            />
          </div>
        </div>
      )}

      {/* Files view */}
      {activeView === 'files' && (
        <div
          style={{
            margin: '0 24px 24px',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          {/* Breadcrumb inside the card */}
          {breadcrumbs.length > 0 && (
            <Breadcrumb
              segments={breadcrumbs}
              onNavigate={(path) => { setCurrentFolderPath(path); }}
            />
          )}

          {fileTree.length === 0 ? (
            <EmptyState onCreateDocument={handleCreateDocument} onCreateFolder={handleCreateFolder} />
          ) : filteredNodes.length === 0 && searchQuery.trim() ? (
            <EmptySearchState />
          ) : filteredNodes.length === 0 ? (
            <EmptyState onCreateDocument={handleCreateDocument} onCreateFolder={handleCreateFolder} />
          ) : (
            <>
              <TableHeader colTemplate={COL_TEMPLATE} />
              <div>
                {filteredNodes.map((node) => (
                  <DocumentBrowserRow
                    key={node.id}
                    node={node}
                    isActive={isNodeActive(node)}
                    onOpen={handleNodeOpen}
                    onRename={onRename}
                    onDelete={onDelete}
                    onDownload={onDownload}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Trash view — delegate entirely to TrashPanel */}
      {activeView === 'trash' && (
        <div
          style={{
            margin: '0 24px 24px',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            background: '#fff',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
          }}
        >
          <TrashPanel
            items={trashItems}
            stats={trashStats}
            onRestore={onRestore}
            onPermanentDelete={onPermanentDelete}
            onEmptyTrash={onEmptyTrash}
            {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
            {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
            {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
          />
        </div>
      )}
    </div>
  );
}
