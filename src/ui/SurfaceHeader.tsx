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
  /** Icon color (a CSS color or token). Defaults to navy; pass the brand blue
   *  (var(--kp-blue)) for surfaces that lead with the colored icon, like Ask. */
  iconColor?: string;
  /** The surface title (e.g. "Matters", "Search", "Documents"). */
  title: string;
  /** Optional controls rendered directly beside the title. */
  titleActions?: React.ReactNode;
  /** A short one-line description shown below the title. */
  description?: React.ReactNode;
  /** Optional element rendered inline, to the LEFT of the icon/title (e.g. a
   *  quiet back chevron). Keeps "back" in the header, not on a floating row. */
  leading?: React.ReactNode;
  /** Optional right-aligned actions (e.g. a "New matter" button). */
  actions?: React.ReactNode;
  /** Optional testid on the header root. */
  testId?: string;
}

export function SurfaceHeader({ Icon, title, titleActions, description, leading, actions, testId, iconColor = 'var(--kp-navy)' }: SurfaceHeaderProps) {
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--kp-space-md)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', marginBottom: 'var(--kp-space-2xs)' }}>
          {leading}
          <Icon
            style={{ width: 'var(--kp-icon-lg)', height: 'var(--kp-icon-lg)', color: iconColor, strokeWidth: 'var(--kp-icon-stroke)', flex: 'none' }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--kp-font-2xl)',
              fontWeight: 'var(--kp-weight-bold)',
              color: 'var(--kp-navy)',
              letterSpacing: '-0.01em',
              lineHeight: 'var(--kp-leading-tight)',
            }}
          >
            {title}
          </h1>
          {titleActions != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', minWidth: 0 }}>
              {titleActions}
            </div>
          )}
        </div>
        {description != null && description !== '' && (
          <p
            style={{
              margin: 0,
              fontSize: 'var(--kp-font-sm)',
              color: 'var(--kp-text-faint)',
              lineHeight: 'var(--kp-leading-normal)',
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
