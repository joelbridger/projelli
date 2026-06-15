/**
 * SurfaceHeader — the ONE standard header for every full-page surface in the
 * reimagined shell. It matches the Matters header exactly: a navy icon + a
 * 22px/700 navy title on the left, a short muted (13px) description below, and
 * an optional actions slot on the right. Every surface (Matters, Search,
 * Documents, Email, Workflows, Activity Log, Settings) uses this so switching
 * tabs feels consistent — each one reads "[icon] Title / description".
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SurfaceHeaderProps {
  /** Lucide icon — use the same icon as the surface's nav item. */
  Icon: LucideIcon;
  /** The surface title (e.g. "Matters", "Search", "Documents"). */
  title: string;
  /** A short one-line description shown below the title. */
  description?: React.ReactNode;
  /** Optional right-aligned actions (e.g. a "New matter" button). */
  actions?: React.ReactNode;
  /** Optional testid on the header root. */
  testId?: string;
}

export function SurfaceHeader({ Icon, title, description, actions, testId }: SurfaceHeaderProps) {
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icon
            style={{ width: 18, height: 18, color: 'var(--kp-navy)', strokeWidth: 1.75, flex: 'none' }}
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
            {title}
          </h1>
        </div>
        {description != null && description !== '' && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.4,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions != null && <div style={{ flex: 'none' }}>{actions}</div>}
    </div>
  );
}

export default SurfaceHeader;
