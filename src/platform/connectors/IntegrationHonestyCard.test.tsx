import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IntegrationHonestyCard } from '@/platform/connectors/IntegrationHonestyCard';
import { integrationHonestyCardIds } from '@/platform/connectors/integrationHonestyCards';

afterEach(cleanup);

describe('IntegrationHonestyCard', () => {
  it('opens and closes the full card dialog', async () => {
    render(<IntegrationHonestyCard connectorId="wealthbox" />);

    fireEvent.click(screen.getByRole('button', { name: /see exactly what wealthbox reads and writes/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Wealthbox');
    expect(dialog.textContent).toContain('What this connector reads');
    expect(dialog.textContent).toContain('What this connector writes');
    expect(dialog.textContent).toContain('What this connector can never touch');
    expect(dialog.textContent).toContain('How writes are gated');
    expect(dialog.textContent).toContain('Limits worth knowing');
    expect(dialog.textContent).toContain('Last verified: 2026-07-10');

    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('renders without crashing for every shipping connector id', async () => {
    for (const id of integrationHonestyCardIds) {
      const { unmount } = render(<IntegrationHonestyCard connectorId={id} />);
      fireEvent.click(screen.getByTestId(`integration-honesty-trigger-${id}`));
      expect(await screen.findByTestId(`integration-honesty-dialog-${id}`)).toBeTruthy();
      unmount();
    }
  });
});
