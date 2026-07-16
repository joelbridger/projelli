import { render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const flags = vi.hoisted(() => ({
  overrides: { useFlag: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flags)
);

import { isEnabled, useFlag, useFlagRegistryVersion } from '@/platform/flags';

function ConsumerShapedFlagsImport(): React.JSX.Element {
  const version = useFlagRegistryVersion();
  return <output data-testid="flag-version">{version}</output>;
}

function FlagConsumer(): React.JSX.Element {
  return <output data-testid="flag-value">{String(useFlag('booking-public-page'))}</output>;
}

describe('platform flags mock helper', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flags);
  });

  afterEach(() => {
    resetPlatformFlagsOverrides(flags);
  });

  it('applies an intentional override', () => {
    const useFlagOverride = vi.fn(() => true);
    setPlatformFlagsOverrides(flags, { useFlag: useFlagOverride });

    render(<FlagConsumer />);
    expect(screen.getByTestId('flag-value')).toHaveTextContent('true');
    expect(useFlagOverride).toHaveBeenCalledWith('booking-public-page');
  });

  it('keeps unoverridden public exports callable for a consumer-shaped import', () => {
    setPlatformFlagsOverrides(flags, { useFlag: () => true });

    expect(isEnabled('booking-public-page')).toBe(false);
    render(<ConsumerShapedFlagsImport />);
    expect(screen.getByTestId('flag-version')).toHaveTextContent('0');
  });

  it('removes an override after reset', () => {
    setPlatformFlagsOverrides(flags, { useFlag: () => true });
    const view = render(<FlagConsumer />);
    expect(screen.getByTestId('flag-value')).toHaveTextContent('true');

    resetPlatformFlagsOverrides(flags);

    view.rerender(<FlagConsumer />);
    expect(screen.getByTestId('flag-value')).toHaveTextContent('false');
  });
});
