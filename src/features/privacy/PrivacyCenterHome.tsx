/**
 * PrivacyCenterHome — "Where your data is" full-page surface.
 *
 * A native full-page surface following the AuditHome pattern:
 * SurfaceHeader, live egress status, the DataMapContent, and a
 * "Confidentiality Report" action for the active matter.
 */
import { useState, useCallback } from 'react';
import { Lock } from 'lucide-react';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { DataMapContent } from '@/platform/privacy/ui/DataMapDialog';
import { ConfidentialityReportDialog } from '@/platform/privacy/ui/ConfidentialityReportDialog';
import { buildConfidentialityReport } from '@/platform/privacy/confidentialityReport';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import type { ConfidentialityReport } from '@/platform/privacy/confidentialityReport';

export interface PrivacyCenterHomeProps {
  auditEntries: AuditEntry[];
  activeMatter: Matter | null;
}

export function PrivacyCenterHome({ auditEntries, activeMatter }: PrivacyCenterHomeProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const confidentialityMode = useConfidentialityMode();
  const [builtReport, setBuiltReport] = useState<ConfidentialityReport | null>(null);

  const buildReport = useCallback((): ConfidentialityReport => {
    return buildConfidentialityReport(auditEntries, {
      matterId: activeMatter?.id ?? null,
      matterName: activeMatter?.name ?? 'All matters',
      generatedAt: new Date().toISOString(),
    });
  }, [auditEntries, activeMatter]);

  const handleOpenReport = useCallback(() => {
    setBuiltReport(buildReport());
    setReportOpen(true);
  }, [buildReport]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={Lock}
          title="Where your data is"
          description="How Keepance handles your information and your AI requests, in plain language you can share with a client."
          actions={
            <Button
              variant="primary"
              size="sm"
              data-testid="privacy-center-report-button"
              onClick={handleOpenReport}
            >
              {activeMatter
                ? `Confidentiality Report for ${activeMatter.name}`
                : 'Confidentiality Report'}
            </Button>
          }
        />
      </div>

      {/* Live egress status strip */}
      <div
        style={{
          padding: 'var(--kp-space-sm) var(--kp-gutter)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          background: 'var(--color-background)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--kp-space-sm)',
        }}
      >
        <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', fontWeight: 'var(--kp-weight-medium)' }}>
          Current mode:
        </span>
        <EgressIndicator provider="anthropic" mode={confidentialityMode} variant="compact" />
        {activeMatter && (
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginLeft: 'auto' }}>
            Scoped to: <strong style={{ color: 'var(--kp-navy)' }}>{activeMatter.name}</strong>
          </span>
        )}
      </div>

      {/* Data Map content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--kp-space-md) var(--kp-gutter)' }}>
        <DataMapContent variant="expanded" />
      </div>

      {/* Confidentiality Report dialog */}
      {builtReport !== null && (
        <ConfidentialityReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          report={builtReport}
        />
      )}
    </div>
  );
}
