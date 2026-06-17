import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidentialityReportDialog } from '@/platform/privacy/ui/ConfidentialityReportDialog';
import { buildConfidentialityReport } from '@/platform/privacy/confidentialityReport';
import type { AuditEntry } from '@/platform/types/audit';

// Helper: build a minimal egress AuditEntry fixture
function egressEntry(overrides: {
  matterId?: string;
  mode: 'local-only' | 'direct' | 'assured';
  dataLeaves?: boolean;
}): AuditEntry {
  const matterId = overrides.matterId ?? 'matter_abc';
  return {
    id: `test_${Math.random()}`,
    timestamp: '2026-06-17T10:00:00Z',
    action: 'egress',
    description: 'egress',
    model: 'claude-3-opus',
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: {
      provider: 'anthropic',
      mode: overrides.mode,
      destination: overrides.mode === 'local-only' ? 'local' : overrides.mode === 'assured' ? 'assured-proxy' : 'provider-direct',
      dataLeaves: overrides.dataLeaves ?? (overrides.mode !== 'local-only'),
      scope: { kind: 'matter', matterId, matterName: 'Garcia v. Meridian' },
    },
  };
}

const MATTER_ID = 'matter_abc';
const MATTER_NAME = 'Garcia v. Meridian';
const GENERATED_AT = '2026-06-17T12:00:00Z';

function makeReport(entries: AuditEntry[]) {
  return buildConfidentialityReport(entries, {
    matterId: MATTER_ID,
    matterName: MATTER_NAME,
    generatedAt: GENERATED_AT,
  });
}

describe('ConfidentialityReportDialog', () => {
  it('renders with data-testid="confidentiality-report"', () => {
    const report = makeReport([]);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    expect(screen.getByTestId('confidentiality-report')).toBeTruthy();
  });

  it('shows the zero-calls attestation when no entries', () => {
    const report = makeReport([]);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    expect(screen.getByTestId('confidentiality-attestation').textContent).toMatch(/no AI activity/i);
  });

  it('shows the local-only attestation for all-local calls', () => {
    const entries = [
      egressEntry({ mode: 'local-only', dataLeaves: false }),
      egressEntry({ mode: 'local-only', dataLeaves: false }),
    ];
    const report = makeReport(entries);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    expect(screen.getByTestId('confidentiality-attestation').textContent).toMatch(/nothing left this machine/i);
  });

  it('shows the direct (BYOK) attestation for direct calls', () => {
    const entries = [
      egressEntry({ mode: 'direct', dataLeaves: true }),
    ];
    const report = makeReport(entries);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    const attestationText = screen.getByTestId('confidentiality-attestation').textContent ?? '';
    expect(attestationText).toMatch(/your own API key/i);
    expect(attestationText).toMatch(/Keepance was not in the path/i);
    // Honesty: must not claim nothing left
    expect(attestationText).not.toMatch(/nothing left this machine/i);
  });

  it('shows the correct number of rows in the call table', () => {
    const entries = [
      egressEntry({ mode: 'direct' }),
      egressEntry({ mode: 'local-only', dataLeaves: false }),
      egressEntry({ mode: 'assured' }),
    ];
    const report = makeReport(entries);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    // Table has 3 data rows (plus 1 header row)
    const table = screen.getByTestId('confidentiality-call-table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
  });

  it('renders the Print button', () => {
    const report = makeReport([]);
    render(
      <ConfidentialityReportDialog
        open={true}
        onOpenChange={() => {}}
        report={report}
      />
    );
    expect(screen.getByTestId('confidentiality-report-print')).toBeTruthy();
  });

  it('does not render when open=false', () => {
    const report = makeReport([]);
    render(
      <ConfidentialityReportDialog
        open={false}
        onOpenChange={() => {}}
        report={report}
      />
    );
    // Dialog content should not be in the DOM when closed
    expect(screen.queryByTestId('confidentiality-report')).toBeNull();
  });
});
