import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Matter } from '@/platform/types/matter';
import { NewAccountFlow } from './NewAccountFlow';
import type { AccountApplicationDraft } from './accountApplication';

const matter: Matter = {
  id: 'matter-hendricks',
  name: 'Hendricks Household',
  client: 'Robert and Susan Hendricks',
  folderPaths: ['/ws/Clients/Hendricks Household'],
  createdAt: '2026-07-09T00:00:00.000Z',
};

function renderFlow(overrides: Partial<ComponentProps<typeof NewAccountFlow>> = {}) {
  const onBack = vi.fn();
  const onGeneratePdf = vi.fn((_draft: AccountApplicationDraft) => Promise.resolve({
    status: 'done' as const,
    message: 'PDF ready',
  }));
  const onCreateDocusignEnvelope = vi.fn((_draft: AccountApplicationDraft) => Promise.resolve({
    status: 'unavailable' as const,
    message: 'DocuSign unavailable',
  }));
  const onAuditLog = vi.fn();
  render(
    <NewAccountFlow
      activeMatter={matter}
      onBack={onBack}
      onGeneratePdf={onGeneratePdf}
      onCreateDocusignEnvelope={onCreateDocusignEnvelope}
      onAuditLog={onAuditLog}
      {...overrides}
    />,
  );
  return { onGeneratePdf, onCreateDocusignEnvelope, onAuditLog };
}

describe('NewAccountFlow', () => {
  it('opens a review-gated prefilled form and only delivers after advisor review', async () => {
    const { onGeneratePdf, onAuditLog } = renderFlow();

    fireEvent.click(screen.getByTestId('new-account-start-review'));

    const ownerName = document.querySelector<HTMLInputElement>('[data-testid="new-account-field-ownerName"]');
    if (!ownerName) throw new Error('owner name input missing');
    expect(ownerName.value).toBe('Robert and Susan Hendricks');
    fireEvent.change(ownerName, { target: { value: 'Robert Hendricks' } });
    expect(ownerName.value).toBe('Robert Hendricks');

    const continueButton = document.querySelector<HTMLButtonElement>('[data-testid="new-account-continue-delivery"]');
    if (!continueButton) throw new Error('continue button missing');
    expect(continueButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('new-account-review-confirm'));
    expect(continueButton.disabled).toBe(false);

    fireEvent.click(continueButton);
    fireEvent.click(screen.getByTestId('new-account-generate-pdf'));

    await waitFor(() => {
      expect(onGeneratePdf).toHaveBeenCalledTimes(1);
    });
    expect(onAuditLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAuditLog.mock.calls[0])).not.toContain('Social Security number');
  });

  it('shows a client-scoped empty state when no client is active', () => {
    renderFlow({ activeMatter: null });

    expect(document.body.contains(screen.getByTestId('new-account-no-client'))).toBe(true);
    expect(document.body.contains(screen.getByText('Choose a client first'))).toBe(true);
  });
});
