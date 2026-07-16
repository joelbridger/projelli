import '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmHomeSurfaceRegistry } from '@/features/crm-home';
import { CrmShellSurface } from './CrmShellSurface';
import { getCrmShellRailDestinations } from './crmHomeRegistryAdapter';
import type { CrmShellRuntime } from './runtime';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

let crmShellEnabled = false;
const flagsMock = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);

function runtimeWithLegacy(legacyHome: () => ReactNode): CrmShellRuntime {
  return {
    legacy: { home: legacyHome },
  };
}

describe('CrmShellSurface', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, {
      useFlag: (id: string) => id === 'crm-shell-v1' && crmShellEnabled,
    });
  });

  afterEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
  });

  it('uses the CRM Home public registry for every rail destination and its order', () => {
    const expected = crmHomeSurfaceRegistry
      .filter(
        (
          surface
        ): surface is (typeof crmHomeSurfaceRegistry)[number] & {
          rail: NonNullable<(typeof crmHomeSurfaceRegistry)[number]['rail']>;
        } => surface.rail !== undefined
      )
      .slice()
      .sort((left, right) => left.rail.order - right.rail.order);

    expect(getCrmShellRailDestinations()).toEqual(expected);
  });

  it('keeps the legacy CRM renderer intact while the v1 flag is off', () => {
    crmShellEnabled = false;
    const legacyHome = vi.fn(() => <div data-testid="legacy-crm-home" />);

    render(<CrmShellSurface runtime={runtimeWithLegacy(legacyHome)} />);

    expect(screen.getByTestId('legacy-crm-home')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-shell-frame')).not.toBeInTheDocument();
    expect(legacyHome).toHaveBeenCalledOnce();
  });

  it('renders registry-backed navigation and resolves the selected destination', async () => {
    crmShellEnabled = true;
    const destinations = getCrmShellRailDestinations();
    const first = destinations[0];
    const next = destinations[1];
    if (!first || !next) throw new Error('Expected CRM rail destinations');

    render(
      <CrmShellSurface
        runtime={runtimeWithLegacy(() => (
          <div />
        ))}
      />
    );

    expect(await screen.findByTestId('crm-shell-frame')).toBeInTheDocument();
    const visibleDestinations = destinations.filter(
      (destination) => destination.flagId === undefined
    );
    expect(
      screen
        .getByRole('navigation', { name: 'CRM navigation' })
        .querySelectorAll('button')
    ).toHaveLength(visibleDestinations.length);
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
      'Calendar'
    );
    expect(screen.getByTestId('crm-shell-content')).not.toHaveTextContent(
      'This CRM destination will appear inside the new practice workspace frame.'
    );
  });
});
