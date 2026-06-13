/**
 * ReimaginedMattersHome — full-page, Clio-grade matters table.
 *
 * The landing surface for the reimagined matter-centric shell. Reads directly
 * from the live matterStore; clicking a row scopes AI retrieval to that client.
 * Self-contained: no required props. Wire it as `mattersContent` in
 * ReimaginedSpine to replace the placeholder.
 *
 * Styling: Tailwind utilities + CSS vars from globals.css (--kp-navy, --kp-blue,
 * --kp-accent, --color-border, --color-muted-foreground). Inline styles for
 * anything that requires a CSS variable directly. Light theme; no dark mode.
 */

import { Briefcase, Lock, Plus, FolderOpen, Scale } from 'lucide-react';
import { useMatters, useActiveMatterId, useMatterStore } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import type { Matter } from '@/types/matter';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PrivilegePill() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        background: 'rgba(10,37,64,0.07)',
        color: 'var(--kp-navy)',
        border: '1px solid rgba(10,37,64,0.18)',
        whiteSpace: 'nowrap',
      }}
    >
      <Lock style={{ width: 10, height: 10, strokeWidth: 2 }} />
      Privileged
    </span>
  );
}

interface MatterRowProps {
  matter: Matter;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function MatterRow({ matter, isActive, onSelect }: MatterRowProps) {
  const label = matterLabel(matter);
  const folderCount = matter.folderPaths.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(matter.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 100px 140px 120px',
        alignItems: 'center',
        gap: 0,
        width: '100%',
        padding: '12px 20px',
        background: isActive ? 'rgba(10,37,64,0.04)' : 'transparent',
        borderLeft: isActive ? '3px solid var(--kp-navy)' : '3px solid transparent',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,37,64,0.02)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }
      }}
    >
      {/* Matter name + client */}
      <div style={{ paddingRight: 16 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--kp-navy)',
            fontFamily: 'Satoshi, sans-serif',
            lineHeight: 1.3,
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        {matter.client && matter.client !== matter.name && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-muted-foreground)',
              fontWeight: 400,
            }}
          >
            {matter.client}
          </div>
        )}
      </div>

      {/* Privilege */}
      <div style={{ paddingRight: 12 }}>
        {matter.privileged && <PrivilegePill />}
      </div>

      {/* Documents / scope */}
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <FolderOpen style={{ width: 13, height: 13, strokeWidth: 1.75, flex: 'none' }} />
        {folderCount === 0
          ? 'No folders'
          : folderCount === 1
          ? '1 folder'
          : `${folderCount} folders`}
      </div>

      {/* Created */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatDate(matter.createdAt)}
      </div>
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
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
      <Scale
        style={{
          width: 36,
          height: 36,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.5,
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
        No matters yet
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        Create your first matter to organize a client's documents and scope AI
        retrieval to their work only.
      </div>
      {/* Stub button — full creation requires folder-picking via MatterManagerDialog */}
      <button
        type="button"
        style={{
          marginTop: 8,
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
          // Full matter creation requires folder-picking; the MatterManagerDialog
          // is the canonical entry point. Dispatching a custom event lets any
          // parent listening (e.g. App.tsx) open that dialog without a prop chain.
          window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'));
        }}
      >
        <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
        New matter
      </button>
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────────────────

function TableHeader() {
  const colStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-muted-foreground)',
    padding: '10px 20px 10px 0',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 100px 140px 120px',
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ ...colStyle, paddingLeft: 3 }}>Matter</div>
      <div style={colStyle}>Privilege</div>
      <div style={colStyle}>Documents</div>
      <div style={colStyle}>Created</div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedMattersHome() {
  const matters = useMatters();
  const activeMatterId = useActiveMatterId();
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);

  const openCount = matters.length;

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
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <Briefcase
              style={{
                width: 18,
                height: 18,
                color: 'var(--kp-navy)',
                strokeWidth: 1.75,
                flex: 'none',
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--kp-navy)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              Matters
            </h1>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.4,
            }}
          >
            {openCount === 0
              ? 'No matters open'
              : openCount === 1
              ? '1 matter open'
              : `${openCount} matters open`}
            {openCount > 0
              ? ' — click a row to scope AI retrieval to that client.'
              : '.'}
          </p>
        </div>

        {/* New matter button — stub; real creation via MatterManagerDialog */}
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--kp-navy)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'));
          }}
        >
          <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
          New matter
        </button>
      </div>

      {/* Table card */}
      <div
        style={{
          margin: '0 24px 24px',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {matters.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <TableHeader />
            <div>
              {matters.map((m) => (
                <MatterRow
                  key={m.id}
                  matter={m}
                  isActive={m.id === activeMatterId}
                  onSelect={setActiveMatter}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
