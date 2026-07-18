import '@/i18n';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrationExport } from '@/platform/crm/migration';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { dataPortabilitySettingsPanel } from './settingsModuleDescriptor';

vi.mock('@/platform/crm/migration', () => ({
  createMigrationExport: vi.fn(),
}));

const completeReceipt = {
  id: 'migration-export:archive',
  kind: 'migration_export',
  exportKind: 'archive',
  status: 'exported',
  exportedAt: '2026-07-18T12:00:00Z',
  manifestId: 'wealthbox-simulator',
  reconciliationReportId: 'migration-report:wealthbox',
  filePath: '/firm/Lantern migration exports/wealthbox-archive.json',
  byteLength: 2048,
  sha256: 'a'.repeat(64),
} as const;

function renderPanel() {
  return render(createElement(dataPortabilitySettingsPanel.render));
}

describe('data export Settings panel', () => {
  beforeEach(() => {
    vi.mocked(createMigrationExport).mockReset();
    useWorkspaceStore.setState({ rootPath: '/firm' });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('waits for an explicit action, invokes the existing archive once, and presents its inspectable receipt', async () => {
    vi.mocked(createMigrationExport).mockResolvedValue(completeReceipt);
    renderPanel();

    expect(createMigrationExport).not.toHaveBeenCalled();
    expect(screen.getByTestId('firm-backup-unavailable')).toHaveTextContent(
      'Complete firm backup unavailable'
    );
    expect(screen.getByTestId('migration-archive-includes')).toHaveTextContent(
      'original imported payload'
    );
    expect(screen.getByTestId('migration-archive-excludes')).toHaveTextContent(
      'documents, email'
    );

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(await screen.findByTestId('migration-archive-result')).toBeVisible();
    expect(createMigrationExport).toHaveBeenCalledTimes(1);
    expect(createMigrationExport).toHaveBeenCalledWith('/firm', 'archive');
    expect(screen.getByTestId('migration-archive-file')).toHaveTextContent(
      completeReceipt.filePath
    );
    expect(screen.getByTestId('migration-archive-size')).toHaveTextContent(
      '2,048 bytes'
    );
    expect(screen.getByTestId('migration-archive-checksum')).toHaveTextContent(
      completeReceipt.sha256
    );
    expect(screen.getByTestId('migration-archive-manifest')).toHaveTextContent(
      completeReceipt.manifestId
    );
    expect(screen.getByTestId('migration-archive-report')).toHaveTextContent(
      completeReceipt.reconciliationReportId
    );
  });

  it('shows the existing export error and no successful artifact', async () => {
    vi.mocked(createMigrationExport).mockRejectedValue(
      new Error('Run the migration before creating an export file.')
    );
    renderPanel();

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(
      await screen.findByTestId('migration-archive-error')
    ).toHaveTextContent('Run the migration before creating an export file.');
    expect(
      screen.queryByTestId('migration-archive-result')
    ).not.toBeInTheDocument();
  });

  it('fails closed when the export response lacks the full inspectable receipt', async () => {
    vi.mocked(createMigrationExport).mockResolvedValue({
      status: 'exported',
      filePath: '/firm/partial.json',
    });
    renderPanel();

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(
      await screen.findByTestId('migration-archive-error')
    ).toHaveTextContent(
      'did not return a complete, inspectable archive receipt'
    );
    expect(
      screen.queryByTestId('migration-archive-result')
    ).not.toBeInTheDocument();
  });

  it('keeps export unavailable when no workspace is open', () => {
    useWorkspaceStore.setState({ rootPath: null });
    renderPanel();

    expect(screen.getByTestId('migration-archive-create')).toBeDisabled();
    expect(
      screen.getByTestId('migration-archive-workspace-required')
    ).toBeVisible();
    expect(createMigrationExport).not.toHaveBeenCalled();
  });
});
