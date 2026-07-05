/**
 * PrivacyCenterHome — "Where your data is" full-page surface.
 *
 * A native full-page surface following the AuditHome pattern:
 * SurfaceHeader, live egress status, the DataMapContent, and a
 * "Confidentiality Report" action for the active matter.
 *
 * Also surfaces the "Generate a security overview for my firm" button that
 * opens the FirmSecurityPack — the printable trust document for IT / GC.
 */
import { useState, useCallback } from 'react';
import { Lock, FileText } from 'lucide-react';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { DataMapContent } from '@/platform/privacy/ui/DataMapDialog';
import { VaultControlCard } from '@/features/firm/vault/VaultControlCard';
import { ConfidentialityReportDialog } from '@/platform/privacy/ui/ConfidentialityReportDialog';
import { buildConfidentialityReport } from '@/platform/privacy/confidentialityReport';
import { getEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import type { ConfidentialityReport } from '@/platform/privacy/confidentialityReport';
import { FirmSecurityPack } from '@/features/privacy/FirmSecurityPack';

export interface PrivacyCenterHomeProps {
  auditEntries: AuditEntry[];
  activeMatter: Matter | null;
}

export function PrivacyCenterHome({ auditEntries, activeMatter }: PrivacyCenterHomeProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [firmPackOpen, setFirmPackOpen] = useState(false);
  const confidentialityMode = useConfidentialityMode();
  const activeProvider = useActiveEgressProvider(confidentialityMode);
  const [builtReport, setBuiltReport] = useState<ConfidentialityReport | null>(null);

  const buildReport = useCallback((): ConfidentialityReport => {
    return buildConfidentialityReport(auditEntries, {
      matterId: activeMatter?.id ?? null,
      // Fixed-English escape hatch: this feeds ConfidentialityReportDialog,
      // which is itself still hardcoded English (see the cleanup2 handoff).
      matterName: activeMatter?.name ?? `All ${getEntityLabelEnglish().other}`,
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
        position: 'relative',
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
          description="How Advisor Prep Hero handles your information and your AI requests, in plain language you can share with a client."
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {/* eslint-disable lantern-i18n/no-hardcoded-string -- trust-document button copy, English-canonical */}
              <Button
                variant="secondary"
                size="sm"
                data-testid="privacy-center-firm-pack-button"
                onClick={() => { setFirmPackOpen(true); }}
              >
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Generate a security overview for my firm
              </Button>
              {/* eslint-enable lantern-i18n/no-hardcoded-string */}
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
            </div>
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
        <EgressIndicator provider={activeProvider} mode={confidentialityMode} variant="compact" />
        {activeMatter && (
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginLeft: 'auto' }}>
            Scoped to: <strong style={{ color: 'var(--kp-navy)' }}>{activeMatter.name}</strong>
          </span>
        )}
      </div>

      {/* Data Map content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--kp-space-md) var(--kp-gutter)' }}>
        <VaultControlCard />
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

      {/* Firm Security Pack overlay — slides in over the privacy center */}
      {firmPackOpen && (
        <div
          data-testid="firm-security-pack-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--color-background)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '0.5rem var(--kp-gutter)',
              borderBottom: '1px solid var(--color-border)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              data-testid="firm-security-pack-close-button"
              onClick={() => { setFirmPackOpen(false); }}
            >
              Close
            </Button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <FirmSecurityPack />
          </div>
        </div>
      )}
    </div>
  );
}
