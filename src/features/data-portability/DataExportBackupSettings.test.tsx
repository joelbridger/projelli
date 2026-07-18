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

const WRITER_FIXTURE_BYTE_LENGTH = 1_050;
const WRITER_FIXTURE_SHA256 =
  'b12847d84c62723e637bb52fac41b265fed396dfe2f3dc09c4cb0787c77f0476';

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

    expect(Buffer.byteLength(writerProducedArchive)).toBe(
      WRITER_FIXTURE_BYTE_LENGTH
    );
    expect(
      createHash('sha256').update(writerProducedArchive).digest('hex')
    ).toBe(WRITER_FIXTURE_SHA256);
    expect(createMigrationExport).not.toHaveBeenCalled();
    expect(screen.getByTestId('firm-backup-unavailable')).toHaveTextContent(
      'Complete firm backup unavailable'
    );
    expect(
      within(screen.getByTestId('migration-archive-includes'))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'The import data saved with each CRM record that can be copied.',
      'The total number of copied records, plus totals for each kind of CRM record.',
      'The import results for each kind of CRM record. Lantern only shows success when those results match the records in the JSON file.',
    ]);
    expect(
      within(screen.getByTestId('migration-archive-excludes'))
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'The documents and attachments themselves.',
      'The email files themselves.',
      'CRM records that are missing any of the import information needed for this copy.',
    ]);

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(await screen.findByTestId('migration-archive-result')).toBeVisible();
    expect(createMigrationExport).toHaveBeenCalledTimes(1);
    expect(createMigrationExport).toHaveBeenCalledWith('/firm', 'archive');
    expect(readTauriTextFile).toHaveBeenCalledWith(receipt.filePath);
    expect(screen.getByTestId('migration-archive-file')).toHaveTextContent(
      receipt.filePath
    );
    expect(screen.getByTestId('migration-archive-size')).toHaveTextContent(
      '1,050 bytes'
    );
    expect(screen.getByTestId('migration-archive-checksum')).toHaveTextContent(
      WRITER_FIXTURE_SHA256
    );
    expect(
      screen.getByTestId('migration-archive-record-count')
    ).toHaveTextContent(/^2$/);
    expect(
      screen.getByTestId('migration-archive-source-types')
    ).toHaveTextContent(/^contact \(1\), external_note \(1\)$/);
    await waitFor(() => {
      expect(screen.getByTestId('migration-archive-create')).toHaveTextContent(
        'Create JSON copy'
      );
    });
  });

  it('fails if the UI content claims grow beyond the contract and manifest', async () => {
    vi.mocked(createMigrationExport).mockResolvedValue(
      receiptForWriterFixture()
    );
    vi.mocked(readTauriTextFile).mockResolvedValue(writerProducedArchive);
    renderPanel();

    const preExportClaimsCopy = screen
      .getByTestId('data-portability-settings')
      .textContent?.replace(/\s+/gu, '');
    expect(preExportClaimsCopy).toBe(
      [
        'Data export',
        'Create a JSON copy of CRM records that still have their original import data.',
        'Complete firm backup unavailable. Needs review.',
        'This is not a complete firm backup.',
        'This only copies CRM records that still have the information saved from their original import. It can include records imported from Wealthbox or another system.',
        'Does not include',
        'The documents and attachments themselves.',
        'The email files themselves.',
        'CRM records that are missing any of the import information needed for this copy.',
        'This JSON file is not encrypted. Store it only in a place your firm approves.',
        'What this JSON file includes',
        'The import data saved with each CRM record that can be copied.',
        'The total number of copied records, plus totals for each kind of CRM record.',
        'The import results for each kind of CRM record. Lantern only shows success when those results match the records in the JSON file.',
        'Create JSON copy',
      ]
        .join('')
        .replace(/\s+/gu, '')
    );

    fireEvent.click(screen.getByTestId('migration-archive-create'));
    expect(await screen.findByTestId('migration-archive-result')).toBeVisible();
    const receipt = receiptForWriterFixture();
    const provenResultText = screen
      .getByTestId('migration-archive-result')
      .textContent?.replace(/\s+/gu, '');
    expect(provenResultText).toBe(
      [
        'JSON copy created and checked',
        'Saved file',
        receipt.filePath,
        'Size',
        '1,050 bytes',
        'CRM records copied',
        '2',
        'Details for your tech team',
        'SHA-256 file check',
        WRITER_FIXTURE_SHA256,
        'Manifest ID',
        receipt.manifestId,
        'Fidelity report ID',
        receipt.reconciliationReportId,
        'CRM record kinds',
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

  it('replaces an engineering error with the safe review message', async () => {
    vi.mocked(createMigrationExport).mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'invoke')")
    );
    renderPanel();

    fireEvent.click(screen.getByTestId('migration-archive-create'));

    expect(
      await screen.findByTestId('migration-archive-error')
    ).toHaveTextContent(
      'Lantern could not finish creating and checking this archive. It needs review. No verified archive is being claimed.'
    );
    expect(
      screen.getByTestId('data-portability-settings')
    ).not.toHaveTextContent(
      "Cannot read properties of undefined (reading 'invoke')"
    );
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
