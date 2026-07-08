/**
 * PrivacyCenterHome — full-page privacy surface.
 *
 * A native full-page surface following the AuditHome pattern:
 * SurfaceHeader, live egress status, the DataMapContent, and a
 * "Confidentiality Report" action for the active matter.
 *
 * Also surfaces the "Generate a security overview for my firm" button that
 * opens the FirmSecurityPack — the printable trust document for IT / GC.
 */
import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, FileText, MapPin, MoreHorizontal } from 'lucide-react';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button, IconButton } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
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
  const { t } = useTranslation();
  const [reportOpen, setReportOpen] = useState(false);
  const [firmPackOpen, setFirmPackOpen] = useState(false);
  const dataMapSectionRef = useRef<HTMLElement | null>(null);
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

  const handleOpenDataMap = useCallback(() => {
    dataMapSectionRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
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
          title="Privacy Center"
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {activeMatter ? (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="privacy-center-report-button"
                  onClick={handleOpenReport}
                >
                  Confidentiality Report
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="privacy-center-open-data-map-button"
                  onClick={handleOpenDataMap}
                >
                  <MapPin className="h-3.5 w-3.5 mr-1.5" />
                  {t('settings.privacy.data-map.cta')}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreHorizontal}
                    label="More privacy actions"
                    variant="secondary"
                    size="sm"
                    data-testid="privacy-center-actions-menu"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {/* eslint-disable lantern-i18n/no-hardcoded-string -- trust-document button copy, English-canonical */}
                  <DropdownMenuItem
                    data-testid="privacy-center-firm-pack-button"
                    className="gap-2"
                    onSelect={() => { setFirmPackOpen(true); }}
                  >
                    <FileText className="h-4 w-4" aria-hidden />
                    Generate a security overview for my firm
                  </DropdownMenuItem>
                  {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                </DropdownMenuContent>
              </DropdownMenu>
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
          Mode
        </span>
        <EgressIndicator provider={activeProvider} mode={confidentialityMode} variant="compact" />
        {activeMatter && (
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginLeft: 'auto' }}>
            Scoped to: <strong style={{ color: 'var(--kp-navy)' }}>{activeMatter.name}</strong>
          </span>
        )}
      </div>

      {/* Data Map content */}
      <div
        data-testid="privacy-center-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--kp-space-md) var(--kp-gutter)' }}
      >
        <section
          ref={dataMapSectionRef}
          data-testid="privacy-center-data-map-section"
          aria-labelledby="privacy-center-data-map-heading"
          style={{ maxWidth: 920 }}
        >
          <h2
            id="privacy-center-data-map-heading"
            className="sr-only"
          >
            Data Map
          </h2>
          <DataMapContent variant="expanded" />
        </section>
        <div style={{ marginTop: 'var(--kp-space-md)' }}>
          <VaultControlCard />
        </div>
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
