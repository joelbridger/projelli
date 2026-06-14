/**
 * ReimaginedDocumentsHome — full-page documents surface for the reimagined shell.
 *
 * Wraps the existing FileTree + MainPanel into the full-page surface recipe so
 * Documents gets the same full-page treatment as Matters, Ask, and Email.
 * No logic is rebuilt here — FileTree and MainPanel are rendered as ReactNode
 * children passed from App.tsx.
 */

import { FolderTree } from 'lucide-react';

interface ReimaginedDocumentsHomeProps {
  fileTreeContent: React.ReactNode;
  mainPanelContent: React.ReactNode;
}

export function ReimaginedDocumentsHome({ fileTreeContent, mainPanelContent }: ReimaginedDocumentsHomeProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '14px 20px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <FolderTree
          style={{
            width: 18,
            height: 18,
            color: 'var(--kp-navy)',
            strokeWidth: 1.75,
            flex: 'none',
          }}
        />
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 2,
            }}
          >
            DOCUMENTS
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--kp-navy)',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            Documents
          </h1>
        </div>
      </div>

      {/* Body: FileTree left + editor right */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* File tree sidebar */}
        <div
          style={{
            width: 280,
            minWidth: 0,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border)',
            background: 'var(--color-background)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {fileTreeContent}
        </div>

        {/* Main editor area */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {mainPanelContent}
        </div>
      </div>
    </div>
  );
}
