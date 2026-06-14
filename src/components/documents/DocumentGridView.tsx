/**
 * DocumentGridView — grid-style file browser for the Documents "Files" tab.
 *
 * Replaces the table-list layout with a card grid: folders first (sorted
 * alphabetically), then files, each showing an icon + name. Folder click
 * drills in; breadcrumb navigates back. All file actions (New document,
 * New folder, Add files, Search, Files/Trash toggle) are included.
 *
 * No Tailwind on layout — all inline styles + CSS vars to stay consistent
 * with the rest of the Documents surface.
 */

import React, { useState, useCallback } from 'react';
import {
  Folder,
  FileText,
  File,
  Image,
  Film,
  Music,
  Plus,
  Upload,
  Search,
  ChevronRight,
} from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { TrashPanel } from '@/components/common/TrashPanel';
import type { TrashRetentionPeriod } from '@/components/common/TrashPanel';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import type { FileNode } from '@/types/workspace';

// ── Icon helpers ───────────────────────────────────────────────────────────

function getGridIcon(node: FileNode): React.ReactNode {
  if (node.type === 'folder') {
    return (
      <Folder
        style={{ width: 32, height: 32, color: '#c0a960', strokeWidth: 1.5 }}
      />
    );
  }
  const ext = (node.extension ?? '').toLowerCase();
  if (ext === 'md' || ext === 'txt' || ext === 'source' || ext === 'rtf' || ext === 'rt') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: 'var(--kp-navy)', strokeWidth: 1.5, opacity: 0.6 }}
      />
    );
  }
  if (ext === 'docx' || ext === 'doc') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: '#2563eb', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'pdf') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: '#dc2626', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg' || ext === 'bmp') {
    return (
      <Image
        style={{ width: 32, height: 32, color: '#16a34a', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'avi' || ext === 'mkv') {
    return (
      <Film
        style={{ width: 32, height: 32, color: '#7c3aed', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a') {
    return (
      <Music
        style={{ width: 32, height: 32, color: '#db2777', strokeWidth: 1.5 }}
      />
    );
  }
  return (
    <File
      style={{ width: 32, height: 32, color: 'var(--kp-navy)', strokeWidth: 1.5, opacity: 0.5 }}
    />
  );
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────

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
                cursor: isLast ? 'default' : 'pointer',
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

// ── File card ──────────────────────────────────────────────────────────────

interface FileCardProps {
  node: FileNode;
  isActive: boolean;
  onOpen: (node: FileNode) => void;
}

function FileCard({ node, isActive, onOpen }: FileCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      data-testid={`grid-card-${node.path}`}
      onClick={() => { onOpen(node); }}
      onMouseEnter={() => { setIsHovered(true); }}
      onMouseLeave={() => { setIsHovered(false); }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '16px 12px',
        borderRadius: 8,
        border: isActive
          ? '2px solid var(--kp-navy)'
          : isHovered
            ? '2px solid rgba(10,37,64,0.2)'
            : '2px solid var(--color-border)',
        background: isActive
          ? 'rgba(10,37,64,0.04)'
          : isHovered
            ? 'rgba(10,37,64,0.02)'
            : '#fff',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'border-color 0.12s, background 0.12s',
        width: '100%',
        minWidth: 0,
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {getGridIcon(node)}
      <span
        style={{
          fontSize: 12,
          fontWeight: node.type === 'folder' ? 700 : 500,
          color: 'var(--kp-navy)',
          wordBreak: 'break-word',
          lineHeight: 1.3,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {node.name}
      </span>
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onCreateDocument: () => void;
  onCreateFolder: () => void;
}

function EmptyState({ onCreateDocument, onCreateFolder }: EmptyStateProps) {
  return (
    <div
      data-testid="grid-empty-state"
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
      <Folder
        style={{
          width: 40,
          height: 40,
          color: 'var(--kp-navy)',
          strokeWidth: 1.25,
          opacity: 0.25,
          marginBottom: 4,
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
          onClick={onCreateFolder}
        >
          <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
          New folder
        </button>
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface DocumentGridViewProps {
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload: (path: string, name: string) => void;
  onCreateDefaultDocument?: () => void;
  onCreateDocxAtRoot?: () => void;
  onAddFiles: () => void;
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

export function DocumentGridView({
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onCreateDefaultDocument,
  onCreateDocxAtRoot,
  onAddFiles,
  trashItems,
  trashStats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod,
  customRetentionDays,
  onRetentionChange,
}: DocumentGridViewProps) {
  const fileTree = useWorkspaceStore((s) => s.fileTree);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);

  const [activeView, setActiveView] = useState<'files' | 'trash'>('files');
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Tree helpers ─────────────────────────────────────────────────────────

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

  // Folders first, then files, each group alphabetically
  const sortedNodes = [...currentNodes].sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });

  const filteredNodes = searchQuery.trim()
    ? sortedNodes.filter((n) =>
        n.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedNodes;

  // ── Breadcrumbs ─────────────────────────────────────────────────────────

  function buildBreadcrumbs(): BreadcrumbSegment[] {
    if (currentFolderPath === null) return [];

    const segments: BreadcrumbSegment[] = [{ label: 'All files', path: null }];

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

  // ── File counts ─────────────────────────────────────────────────────────

  const totalFileCount = (function count(nodes: FileNode[]): number {
    let total = 0;
    for (const n of nodes) {
      if (n.type === 'file') total += 1;
      else if (n.children) total += count(n.children);
    }
    return total;
  })(fileTree);

  const trashBadgeCount = trashStats.itemCount;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleNodeOpen = useCallback((node: FileNode) => {
    if (node.type === 'folder') {
      setCurrentFolderPath(node.path);
      setSearchQuery('');
    } else {
      void onFileOpen(node.path, node.name);
    }
  }, [onFileOpen]);

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

  // ── Is a node the active tab? ────────────────────────────────────────────

  function isNodeActive(node: FileNode): boolean {
    if (node.type === 'folder') return false;
    return (
      node.path === activeTabPath &&
      openTabs.some((t) => {
        const tabType = t.type ?? 'file';
        return (
          t.path === activeTabPath &&
          tabType !== 'ai-assistant' &&
          tabType !== 'workflow-execution' &&
          tabType !== 'email'
        );
      })
    );
  }

  // ── Segment button shared styles ─────────────────────────────────────────

  const segmentBtnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    borderRadius: 0,
    transition: 'background 0.1s, color 0.1s',
    fontFamily: 'Satoshi, sans-serif',
    whiteSpace: 'nowrap',
  };

  const segmentActive: React.CSSProperties = {
    background: 'var(--kp-navy)',
    color: '#fff',
  };

  const segmentInactive: React.CSSProperties = {
    background: '#fff',
    color: 'var(--color-muted-foreground)',
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="document-grid-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* ── Top toolbar ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Files / Trash toggle */}
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

        {/* Action buttons — shown only in files view */}
        {activeView === 'files' && (
          <>
            <button
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--kp-navy)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'Satoshi, sans-serif',
                whiteSpace: 'nowrap',
              }}
              onClick={handleCreateDocument}
            >
              <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
              New document
            </button>

            <button
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: '#fff',
                color: 'var(--kp-navy)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                fontFamily: 'Satoshi, sans-serif',
                whiteSpace: 'nowrap',
              }}
              onClick={handleCreateFolder}
            >
              <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
              New folder
            </button>

            <button
              type="button"
              data-testid="add-files-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: '#fff',
                color: 'var(--kp-navy)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                fontFamily: 'Satoshi, sans-serif',
                whiteSpace: 'nowrap',
              }}
              onClick={onAddFiles}
            >
              <Upload style={{ width: 14, height: 14, strokeWidth: 2 }} />
              Add files
            </button>

            {/* Spacer + search */}
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
                  width: 160,
                  fontFamily: 'Satoshi, sans-serif',
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
        {activeView === 'files' ? (
          <>
            {/* Breadcrumb row */}
            {breadcrumbs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Breadcrumb
                  segments={breadcrumbs}
                  onNavigate={(path) => {
                    setCurrentFolderPath(path);
                    setSearchQuery('');
                  }}
                />
              </div>
            )}

            {/* Subtitle */}
            {breadcrumbs.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-muted-foreground)',
                  marginBottom: 12,
                }}
              >
                {totalFileCount === 0
                  ? 'No documents yet'
                  : totalFileCount === 1
                    ? '1 document'
                    : `${String(totalFileCount)} documents`}
              </div>
            )}

            {/* Grid or empty state */}
            {fileTree.length === 0 ? (
              <EmptyState
                onCreateDocument={handleCreateDocument}
                onCreateFolder={handleCreateFolder}
              />
            ) : filteredNodes.length === 0 && searchQuery.trim() ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
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
                <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)' }}>
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  No files match your search. Try a different name.
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                </div>
              </div>
            ) : filteredNodes.length === 0 ? (
              <EmptyState
                onCreateDocument={handleCreateDocument}
                onCreateFolder={handleCreateFolder}
              />
            ) : (
              <div
                data-testid="document-grid-cards"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 10,
                }}
              >
                {filteredNodes.map((node) => (
                  <FileCard
                    key={node.id}
                    node={node}
                    isActive={isNodeActive(node)}
                    onOpen={handleNodeOpen}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* Trash view */
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: '#fff',
              overflow: 'hidden',
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
    </div>
  );
}
