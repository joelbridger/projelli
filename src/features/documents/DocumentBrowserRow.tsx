/**
 * DocumentBrowserRow — a single file or folder row in DocumentBrowser.
 *
 * Uses the ReimaginedMattersHome row pattern: grid layout, hover/active state
 * via inline event handlers, icon-only action buttons revealed on hover.
 */

import React, { useState } from 'react';
import { File, FileText, Folder, Pencil, Trash2, Download } from 'lucide-react';
import type { FileNode } from '@/platform/types/workspace';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(date: Date | undefined): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(node: FileNode): React.ReactNode {
  if (node.type === 'folder') {
    return (
      <Folder
        style={{
          width: 16,
          height: 16,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.75,
          flex: 'none',
        }}
      />
    );
  }
  const ext = node.extension?.toLowerCase();
  if (ext === 'md' || ext === 'txt' || ext === 'source') {
    return (
      <FileText
        style={{
          width: 16,
          height: 16,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.75,
          flex: 'none',
        }}
      />
    );
  }
  return (
    <File
      style={{
        width: 16,
        height: 16,
        color: 'var(--color-muted-foreground)',
        strokeWidth: 1.75,
        flex: 'none',
      }}
    />
  );
}

function ExtensionBadge({ ext }: { ext: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        background: 'rgba(10,37,64,0.07)',
        color: 'var(--kp-navy)',
        border: '1px solid rgba(10,37,64,0.14)',
        whiteSpace: 'nowrap',
        marginLeft: 6,
        textTransform: 'uppercase',
      }}
    >
      {ext}
    </span>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface DocumentBrowserRowProps {
  node: FileNode;
  isActive: boolean;
  onOpen: (node: FileNode) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDownload: (path: string, name: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function DocumentBrowserRow({
  node,
  isActive,
  onOpen,
  onRename,
  onDelete,
  onDownload,
}: DocumentBrowserRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  const typeLabel =
    node.type === 'folder'
      ? 'Folder'
      : node.extension
        ? node.extension.toUpperCase()
        : 'File';

  const rowBackground = isActive
    ? 'rgba(10,37,64,0.04)'
    : isHovered
      ? 'rgba(10,37,64,0.02)'
      : 'transparent';

  const rowBorderLeft = isActive
    ? '3px solid var(--kp-navy)'
    : '3px solid transparent';

  function handleActionClick(
    e: React.MouseEvent,
    cb: () => void,
  ) {
    e.stopPropagation();
    cb();
  }

  return (
    <button
      type="button"
      onClick={() => { onOpen(node); }}
      onMouseEnter={() => { setIsHovered(true); }}
      onMouseLeave={() => { setIsHovered(false); }}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 130px 90px 80px',
        alignItems: 'center',
        gap: 0,
        width: '100%',
        padding: '12px 20px',
        background: rowBackground,
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: rowBorderLeft,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* Name cell */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingRight: 16,
          minWidth: 0,
        }}
      >
        {getFileIcon(node)}
        <span
          style={{
            fontSize: 14,
            fontWeight: node.type === 'folder' ? 700 : 600,
            color: 'var(--kp-navy)',
            fontFamily: 'Satoshi, sans-serif',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.name}
        </span>
        {node.type === 'file' && node.extension && (
          <ExtensionBadge ext={node.extension} />
        )}
      </div>

      {/* Type cell */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          paddingRight: 8,
        }}
      >
        {typeLabel}
      </div>

      {/* Modified cell */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          fontVariantNumeric: 'tabular-nums',
          paddingRight: 8,
        }}
      >
        {formatDate(node.modifiedAt)}
      </div>

      {/* Size cell */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          fontVariantNumeric: 'tabular-nums',
          paddingRight: 8,
        }}
      >
        {node.type === 'file' ? formatSize(node.size) : ''}
      </div>

      {/* Actions cell */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          justifyContent: 'flex-end',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.12s',
        }}
      >
        <button
          type="button"
          title="Rename"
          onClick={(e) => {
            handleActionClick(e, () => { onRename(node.path); });
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            borderRadius: 4,
            color: 'var(--color-muted-foreground)',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--kp-navy)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'var(--color-muted-foreground)';
          }}
        >
          <Pencil style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
        </button>

        {node.type === 'file' && (
          <button
            type="button"
            title="Download"
            onClick={(e) => {
              handleActionClick(e, () => { onDownload(node.path, node.name); });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              borderRadius: 4,
              color: 'var(--color-muted-foreground)',
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--kp-navy)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color =
                'var(--color-muted-foreground)';
            }}
          >
            <Download style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
          </button>
        )}

        <button
          type="button"
          title="Delete"
          onClick={(e) => {
            handleActionClick(e, () => { onDelete(node.path); });
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            borderRadius: 4,
            color: 'var(--color-muted-foreground)',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#dc2626';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'var(--color-muted-foreground)';
          }}
        >
          <Trash2 style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
        </button>
      </div>
    </button>
  );
}
