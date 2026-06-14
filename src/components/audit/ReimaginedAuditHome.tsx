/**
 * ReimaginedAuditHome — full-page AI Audit surface.
 *
 * Wraps the existing AuditLog full-width so it gets the full-page treatment.
 */

import { ShieldCheck } from 'lucide-react';
import { AuditLog } from '@/components/common/AuditLog';
import type { AuditEntry } from '@/types/audit';

interface ReimaginedAuditHomeProps {
  entries: AuditEntry[];
}

export function ReimaginedAuditHome({ entries }: ReimaginedAuditHomeProps) {
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
        <ShieldCheck
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
            AI AUDIT
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
            AI Audit
          </h1>
        </div>
      </div>

      {/* Body: AuditLog full-width */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <AuditLog entries={entries} />
      </div>
    </div>
  );
}
