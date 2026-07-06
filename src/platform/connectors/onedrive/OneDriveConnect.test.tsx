/* eslint-disable lantern-i18n/no-hardcoded-string */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OneDriveConnect } from './OneDriveConnect';
import { SourcePanel } from '@/features/ask/SourcePanel';
import {
  getCitationVerificationCacheSnapshotForTests,
  resetCitationVerificationForTests,
} from '@/features/ask/citationVerification';
import type { AnswerCitation } from '@/features/ask/askHelpers';
import type { CitationVerdict } from '@/platform/utils/tauri-commands';
import type { ImportStatus } from '@/features/ask/useStillImporting';

const {
  oneDriveCancelMock,
  oneDriveDisconnectMock,
  oneDriveIsConnectedMock,
  oneDriveLogDurableMock,
  ragVerifyCitationsBatchMock,
  useStillImportingMock,
} = vi.hoisted(() => ({
  oneDriveCancelMock: vi.fn(),
  oneDriveDisconnectMock: vi.fn(),
  oneDriveIsConnectedMock: vi.fn(),
  oneDriveLogDurableMock: vi.fn(),
  ragVerifyCitationsBatchMock: vi.fn(),
  useStillImportingMock: vi.fn<() => ImportStatus>(),
}));

vi.mock('@/platform/utils/onedrive-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/onedrive-commands')>();
  return {
    ...original,
    oneDriveCancel: (...args: unknown[]): unknown => oneDriveCancelMock(...args),
    oneDriveDisconnect: (...args: unknown[]): unknown => oneDriveDisconnectMock(...args),
    oneDriveIsConnected: (...args: unknown[]): unknown => oneDriveIsConnectedMock(...args),
  };
});

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragVerifyCitationsBatch: (...args: unknown[]): unknown => ragVerifyCitationsBatchMock(...args),
  };
});

vi.mock('@/features/ask/useStillImporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/ask/useStillImporting')>();
  return { ...original, useStillImporting: (): ImportStatus => useStillImportingMock() };
});

vi.mock('@/platform/connectors/onedrive/useOneDriveSync', () => ({
  useOneDriveSync: vi.fn(),
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useConfidentialityMode: vi.fn(() => 'direct'),
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isPersistedLocalOnly: vi.fn(() => false),
}));

vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: vi.fn(function AuditService() {
    return { logDurable: oneDriveLogDurableMock };
  }),
  auditEventToEntry: vi.fn((entry) => entry),
}));

vi.mock('@/platform/connectors/oauthPending', () => ({
  beginOAuth: vi.fn(),
  endOAuth: vi.fn(),
}));

function makeCitation(): AnswerCitation {
  return {
    n: 1,
    label: 'retirement-plan.txt',
    excerpt: 'The client wants to retire at 62.',
    path: 'Clients/Acme/retirement-plan.txt',
    locator: 'paragraph 1',
    verified: false,
    id: 'chunk-onedrive-cache',
    matterId: 'matter-acme',
  };
}

beforeEach(() => {
  resetCitationVerificationForTests();
  vi.clearAllMocks();
  oneDriveCancelMock.mockResolvedValue(undefined);
  oneDriveLogDurableMock.mockResolvedValue(undefined);
  oneDriveDisconnectMock.mockResolvedValue({
    tokenDeleted: true,
    ragPurged: true,
    localDataPurged: true,
    dataRemains: false,
    warnings: [],
  });
  oneDriveIsConnectedMock.mockResolvedValue(true);
  ragVerifyCitationsBatchMock.mockResolvedValue([
    { verdict: 'verified' } satisfies CitationVerdict,
  ]);
  useStillImportingMock.mockReturnValue('idle');
});

describe('OneDriveConnect — disconnect clears citation verification cache', () => {
  it('re-checks a verified citation after OneDrive reports that RAG rows were purged', async () => {
    const cite = makeCitation();

    render(
      <>
        <SourcePanel citations={[cite]} selectedN={null} onSelect={() => {}} />
        <OneDriveConnect />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('verify-status').dataset['state']).toBe('verified');
    });
    expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(1);
    expect(getCitationVerificationCacheSnapshotForTests().verdictKeys).toHaveLength(1);

    await waitFor(() => {
      expect(screen.getByTestId('onedrive-disconnect')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('onedrive-disconnect'));
    fireEvent.click(screen.getByTestId('onedrive-disconnect-confirm'));

    await waitFor(() => {
      expect(oneDriveDisconnectMock).toHaveBeenCalledWith(false);
    });
    await waitFor(() => {
      expect(ragVerifyCitationsBatchMock).toHaveBeenCalledTimes(2);
    });
  });
});
