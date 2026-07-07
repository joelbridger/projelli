import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PrivacyCenterHome } from '@/features/privacy/PrivacyCenterHome';
import { KeychainService } from '@/platform/providers/KeychainService';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';

// Mock EgressIndicator — expose `provider` so BUG-001 tests can assert on it.
vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: ({ mode, provider }: { mode: string; provider: string }) => (
    <div data-testid="egress-indicator-mock" data-mode={mode} data-provider={provider} />
  ),
}));

// Mock DataMapContent (large read-only document, not under test here)
vi.mock('@/platform/privacy/ui/DataMapDialog', () => ({
  DataMapContent: () => <div data-testid="data-map-content-mock" />,
  DataMapDialog: () => null,
}));

// Mock ConfidentialityReportDialog (tested separately in its own file)
vi.mock('@/platform/privacy/ui/ConfidentialityReportDialog', () => ({
  ConfidentialityReportDialog: ({ open }: { open: boolean }) => (
    open ? <div data-testid="confidentiality-report-dialog-mock" /> : null
  ),
}));

// Mock useConfidentialityMode
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useConfidentialityMode: () => 'direct',
}));

// Mock useEntityLabel (used by SurfaceHeader-related components, and
// getEntityLabelEnglish for the confidentiality-report "All <entity>" default).
vi.mock('@/platform/hooks/useEntityLabel', () => ({
  useEntityLabel: () => ({ one: 'matter', other: 'matters', Other: 'Matters' }),
  getEntityLabel: () => ({ one: 'matter', other: 'matters', One: 'Matter', Other: 'Matters' }),
  getEntityLabelEnglish: () => ({ one: 'matter', other: 'matters', One: 'Matter', Other: 'Matters' }),
}));

const SAMPLE_ENTRIES: AuditEntry[] = [];

// Reset localStorage between tests so API-key state doesn't bleed across.
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* tolerate environments without localStorage */
  }
});

const SAMPLE_MATTER: Matter = {
  id: 'matter_abc',
  name: 'Garcia v. Meridian',
  client: 'Garcia',
  folderPaths: [],
  createdAt: '2026-06-17T00:00:00Z',
};

describe('PrivacyCenterHome', () => {
  it('renders without crashing with no active matter', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    // The data map content mock should be present
    expect(screen.getByTestId('data-map-content-mock')).toBeTruthy();
  });

  it('renders the Data Map as its own labeled section inside Privacy Center', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);

    const section = screen.getByTestId('privacy-center-data-map-section');
    expect(within(section).getByRole('heading', { name: 'Data Map' })).toBeTruthy();
    expect(within(section).getByTestId('data-map-content-mock')).toBeTruthy();
  });

  it('renders the report button', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    expect(screen.getByTestId('privacy-center-report-button')).toBeTruthy();
  });

  it('shows generic "Confidentiality Report" button label when no active matter', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    expect(screen.getByTestId('privacy-center-report-button').textContent).toContain('Confidentiality Report');
  });

  it('shows matter-scoped button label when matter is active', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={SAMPLE_MATTER} />);
    expect(screen.getByTestId('privacy-center-report-button').textContent).toContain('Garcia v. Meridian');
  });

  it('clicking the report button opens the dialog', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    // Dialog not open initially
    expect(screen.queryByTestId('confidentiality-report-dialog-mock')).toBeNull();
    // Click the report button
    fireEvent.click(screen.getByTestId('privacy-center-report-button'));
    // Dialog should now be open
    expect(screen.getByTestId('confidentiality-report-dialog-mock')).toBeTruthy();
  });

  it('renders the egress indicator strip', () => {
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    expect(screen.getByTestId('egress-indicator-mock')).toBeTruthy();
  });

  // BUG-001: Privacy Center "Current mode" must show the RESOLVED provider,
  // not always 'anthropic'. With only an OpenAI key configured the indicator
  // must match the trust bar (openai), not stay hardcoded to anthropic.
  it('BUG-001: shows resolved provider (openai) when only an OpenAI key is configured', async () => {
    // Key presence comes from KeychainService (the same source Ask sends with),
    // not a legacy apiKey_* localStorage value.
    await new KeychainService().setKey('openai', 'sk-test-00000000000000000000');
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    const indicator = await screen.findByTestId('egress-indicator-mock');
    await waitFor(() => expect(indicator.getAttribute('data-provider')).toBe('openai'));
  });

  it('UX-01: shows "No AI connected" (none), not a guessed provider, when no API keys are configured', () => {
    // Previously this fell back to a guessed 'anthropic'. The egress badge is the
    // #1 trust signal, so when nothing is configured it must be honest: 'none'.
    render(<PrivacyCenterHome auditEntries={SAMPLE_ENTRIES} activeMatter={null} />);
    const indicator = screen.getByTestId('egress-indicator-mock');
    expect(indicator.getAttribute('data-provider')).toBe('none');
  });
});
