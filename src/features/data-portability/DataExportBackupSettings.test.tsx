import '@/i18n';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrationExport } from '@/platform/crm/migration';
import { readTauriTextFile } from '@/platform/fs/tauriFsPlugin';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import writerProducedArchive from './__fixtures__/writer-produced-archive.json?raw';
import { dataPortabilitySettingsPanel } from './settingsModuleDescriptor';

vi.mock('@/platform/crm/migration', () => ({
  createMigrationExport: vi.fn(),
}));

vi.mock('@/platform/fs/tauriFsPlugin', () => ({
  readTauriTextFile: vi.fn(),
}));

function receiptForWriterFixture(text = writerProducedArchive) {
  const parsed = JSON.parse(text) as { manifest: { batchId: string } };
  return {
    id: 'migration-export:archive',
    kind: 'migration_export',
    exportKind: 'archive',
    status: 'exported',
    exportedAt: '2026-07-18T11:06:27.267611553+00:00',
    manifestId: parsed.manifest.batchId,
    reconciliationReportId: 'migration-report:wealthbox',
    filePath:
      '/firm/Lantern migration exports/wealthbox-archive-writer-fixture.json',
    byteLength: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
  } as const;
}

function renderPanel() {
  return render(createElement(dataPortabilitySettingsPanel.render));
}

describe('data export Settings panel', () => {
  beforeEach(() => {
    vi.mocked(createMigrationExport).mockReset();
    vi.mocked(readTauriTextFile).mockReset();
    useWorkspaceStore.setState({ rootPath: '/firm' });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('is dark by default through its registered flag', () => {
    expect(dataPortabilitySettingsPanel.flagId).toBe('data-export-backup');
  });

  it('drives the real manifest boundary with a native-writer-produced archive fixture', async () => {
    const receipt = receiptForWriterFixture();
    vi.mocked(createMigrationExport).mockResolvedValue(receipt);
    vi.mocked(readTauriTextFile).mockResolvedValue(writerProducedArchive);
    renderPanel();

    expect(createMigrationExport).not.toHaveBeenCalled();
    expect(screen.getByTestId('firm-backup-unavailable')).toHaveTextContent(
      'Complete firm backup unavailable'
    );
    expect(
      within(screen.getByTestId('migration-archive-includes'))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'For each eligible stored CRM record: its source type, source ID, copied source payload, and target record ID when one is stored.',
      'A manifest with the total record count and counts by source record type.',
      'The fidelity rows saved in the migration report. Success is shown only when every archived source type has a matching, reconciled row.',
    ]);
    expect(screen.getByTestId('migration-archive-excludes')).toHaveTextContent(
      'The contract omits stored records missing any of the three source fields.'
    );

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(await screen.findByTestId('migration-archive-result')).toBeVisible();
    expect(createMigrationExport).toHaveBeenCalledTimes(1);
    expect(createMigrationExport).toHaveBeenCalledWith('/firm', 'archive');
    expect(readTauriTextFile).toHaveBeenCalledWith(receipt.filePath);
    expect(screen.getByTestId('migration-archive-file')).toHaveTextContent(
      receipt.filePath
    );
    expect(screen.getByTestId('migration-archive-size')).toHaveTextContent(
      '1,051 bytes'
    );
    expect(screen.getByTestId('migration-archive-checksum')).toHaveTextContent(
      receipt.sha256
    );
    expect(
      screen.getByTestId('migration-archive-record-count')
    ).toHaveTextContent(/^2$/);
    expect(
      screen.getByTestId('migration-archive-source-types')
    ).toHaveTextContent(/^contact \(1\), external_note \(1\)$/);
    await waitFor(() => {
      expect(screen.getByTestId('migration-archive-create')).toHaveTextContent(
        'Create CRM source-record archive'
      );
    });
  });

  it('fails if the UI content claims grow beyond the contract and manifest', async () => {
    vi.mocked(createMigrationExport).mockResolvedValue(
      receiptForWriterFixture()
    );
    vi.mocked(readTauriTextFile).mockResolvedValue(writerProducedArchive);
    renderPanel();

    expect(
      screen.getByText(/does not select only Wealthbox records/i)
    ).toBeVisible();
    expect(
      screen.queryByText(/only Wealthbox records are included/i)
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('migration-archive-includes')).getAllByRole(
        'listitem'
      )
    ).toHaveLength(3);

    fireEvent.click(screen.getByTestId('migration-archive-create'));
    expect(await screen.findByTestId('migration-archive-result')).toBeVisible();
    const receipt = receiptForWriterFixture();
    const provenResultText = screen
      .getByTestId('migration-archive-result')
      .textContent?.replace(/\s+/gu, '');
    expect(provenResultText).toBe(
      [
        'Archive created and manifest checked',
        'Saved file',
        receipt.filePath,
        'Size',
        '1,051 bytes',
        'SHA-256 checksum',
        receipt.sha256,
        'Manifest ID',
        receipt.manifestId,
        'Fidelity report ID',
        receipt.reconciliationReportId,
        'Archived records',
        '2',
        'Manifest source types',
        'contact (1), external_note (1)',
      ]
        .join('')
        .replace(/\s+/gu, '')
    );
  });

  it('fails closed when an archived source type has no fidelity row', async () => {
    const missingCoverage = JSON.parse(writerProducedArchive) as {
      manifest: { fidelityMatrix: Array<{ sourceType: string }> };
    };
    missingCoverage.manifest.fidelityMatrix =
      missingCoverage.manifest.fidelityMatrix.filter(
        (row) => row.sourceType !== 'external_note'
      );
    const text = JSON.stringify(missingCoverage);
    vi.mocked(createMigrationExport).mockResolvedValue(
      receiptForWriterFixture(text)
    );
    vi.mocked(readTauriTextFile).mockResolvedValue(text);
    renderPanel();

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(
      await screen.findByTestId('migration-archive-error')
    ).toHaveTextContent('needs review');
    expect(
      screen.queryByTestId('migration-archive-result')
    ).not.toBeInTheDocument();
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
    expect(readTauriTextFile).not.toHaveBeenCalled();
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
    ).toHaveTextContent('needs review');
    expect(
      screen.queryByTestId('migration-archive-result')
    ).not.toBeInTheDocument();
    expect(readTauriTextFile).not.toHaveBeenCalled();
  });

  it('keeps export unavailable when no workspace is open', () => {
    useWorkspaceStore.setState({ rootPath: null });
    renderPanel();

    expect(screen.getByTestId('migration-archive-create')).toBeDisabled();
    expect(
      screen.getByTestId('migration-archive-workspace-required')
    ).toBeVisible();
    expect(createMigrationExport).not.toHaveBeenCalled();
    expect(readTauriTextFile).not.toHaveBeenCalled();
  });
});
