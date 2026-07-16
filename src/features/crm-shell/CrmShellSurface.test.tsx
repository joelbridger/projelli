import '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { crmHomeSurfaceRegistry } from '@/features/crm-home';
import { CrmShellSurface } from './CrmShellSurface';
import { getCrmShellRailDestinations } from './crmHomeRegistryAdapter';

let crmShellEnabled = false;

vi.mock('@/platform/flags', () => ({
  useFlag: () => crmShellEnabled,
}));

describe('CrmShellSurface', () => {
  it('uses the CRM Home public registry for every rail destination and its order', () => {
    const expected = crmHomeSurfaceRegistry
      .filter(
        (surface): surface is (typeof crmHomeSurfaceRegistry)[number] & {
          rail: NonNullable<(typeof crmHomeSurfaceRegistry)[number]['rail']>;
        } => surface.rail !== undefined
      )
      .slice()
      .sort((left, right) => left.rail.order - right.rail.order);

    expect(getCrmShellRailDestinations()).toEqual(expected);
  });

  it('is inert while its flag is off, before CRM frame content can mount', () => {
    crmShellEnabled = false;
    render(<CrmShellSurface />);

    expect(screen.queryByTestId('crm-shell-frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-shell-content')).not.toBeInTheDocument();
  });

  it('renders registry-backed navigation and switches the frame selection', () => {
    crmShellEnabled = true;
    const destinations = getCrmShellRailDestinations();
    const first = destinations[0];
    const next = destinations[1];
    if (!first || !next) throw new Error('Expected CRM rail destinations');

    render(<CrmShellSurface />);

    expect(screen.getByTestId('crm-shell-frame')).toBeInTheDocument();
    expect(
      screen
        .getByRole('navigation', { name: 'CRM navigation' })
        .querySelectorAll('button')
    ).toHaveLength(destinations.length);
    expect(screen.getByTestId(`crm-shell-nav-${first.route}`)).toHaveAttribute(
      'aria-current',
      'page'
    );

    fireEvent.click(screen.getByTestId(`crm-shell-nav-${next.route}`));

    expect(screen.getByTestId(`crm-shell-nav-${next.route}`)).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByTestId('crm-shell-content')).toHaveTextContent(
      'This CRM destination will appear inside the new practice workspace frame.'
    );
  });
});
