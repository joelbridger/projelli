import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { V1ShellFrame } from './V1ShellFrame';
import { getOrderedAppSurfaces } from '@/app/shell/registry/appSurfaceRegistry';
import { useFirmStore } from '@/platform/firm/firmStore';

describe('V1ShellFrame', () => {
  afterEach(() => {
    useFirmStore.setState({ session: null });
  });

  it('renders primary and utility navigation in registry placement and order', () => {
    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div>Surface</div>
      </V1ShellFrame>
    );

    for (const placement of ['primary', 'utility'] as const) {
      const renderedIds = Array.from(
        screen
          .getByTestId(`v1-shell-${placement}-nav`)
          .querySelectorAll('button')
      ).map((button) =>
        button.getAttribute('data-testid')?.replace('v1-shell-nav-', '')
      );
      expect(renderedIds).toEqual(
        getOrderedAppSurfaces(placement).map((surface) => surface.id)
      );
    }
    expect(
      screen.getByRole('link', { name: 'Skip to content' })
    ).toHaveAttribute('href', '#main-content');
  });

  it('opens the existing command palette through its supplied trigger', () => {
    const onOpenCommandPalette = vi.fn();
    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={onOpenCommandPalette}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrame>
    );

    fireEvent.click(screen.getByTestId('v1-shell-command-trigger'));
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });

  it('uses the live firm seat count in the firm-card summary', () => {
    useFirmStore.setState({
      session: {
        userId: 'advisor-1',
        email: 'advisor@example.com',
        role: 'admin',
        org: {
          org_id: 'firm-1',
          name: 'Northstar Wealth',
          plan: 'practice',
          packs: [],
          seat_limit: 10,
        },
        seatId: 'seat-1',
        tier: 'practice',
        packs: [],
        seats: 3,
        lastValidatedAt: null,
        activated: true,
      },
    });

    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrame>
    );

    expect(screen.getByTestId('v1-shell-firm-card')).toHaveTextContent(
      'Firm workspace · 3 people'
    );
  });

  it('keeps the account window reachable from the avatar', () => {
    const onOpenAccount = vi.fn();
    window.addEventListener('lantern:open-account', onOpenAccount, {
      once: true,
    });
    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrame>
    );

    fireEvent.click(screen.getByTestId('v1-shell-account-identity'));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });

  it('shows the shared-client slot only for a shared surface', () => {
    const props = {
      onOpenCommandPalette: vi.fn(),
      onSurfaceChange: vi.fn(),
    };
    const { rerender } = render(
      <V1ShellFrame activeSurface="home" {...props}>
        <div />
      </V1ShellFrame>
    );
    expect(
      screen.queryByTestId('v1-shell-client-bar-slot')
    ).not.toBeInTheDocument();

    rerender(
      <V1ShellFrame activeSurface="matters" {...props}>
        <div />
      </V1ShellFrame>
    );
    expect(screen.getByTestId('v1-shell-client-bar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('shared-client-bar')).toBeInTheDocument();
  });

  it('routes nav clicks using the registered surface id', () => {
    const onSurfaceChange = vi.fn();
    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={onSurfaceChange}
      >
        <div />
      </V1ShellFrame>
    );

    fireEvent.click(screen.getByTestId('v1-shell-nav-matters'));
    expect(onSurfaceChange).toHaveBeenCalledWith('matters');
  });
});
