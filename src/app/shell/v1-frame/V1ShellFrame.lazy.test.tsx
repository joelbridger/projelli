import { createElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import { getKnownAppSurfaceDescriptors } from '@/app/shell/registry/appSurfaceRegistry';

const lazyRegistration = vi.hoisted(() => {
  let resolve!: (descriptor: AppSurfaceDescriptor) => void;
  const promise = new Promise<AppSurfaceDescriptor>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
});

vi.mock('@/app/shell/registry/legacyAppSurfaceDescriptors', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/shell/registry/legacyAppSurfaceDescriptors')
  >('@/app/shell/registry/legacyAppSurfaceDescriptors');

  return {
    ...actual,
    legacyTrashSurface: () => lazyRegistration.promise,
  };
});

import { V1ShellFrame } from '@/app/shell/v1-frame';

describe('V1ShellFrame lazy registry integration', () => {
  it('keeps a lazy non-blessed destination out of the permanent rail after resolution', async () => {
    render(
      <V1ShellFrame
        activeSurface="home"
        onOpenCommandPalette={vi.fn()}
        onSurfaceChange={vi.fn()}
      >
        <div />
      </V1ShellFrame>
    );

    expect(screen.queryByTestId('v1-shell-nav-trash')).not.toBeInTheDocument();

    await act(async () => {
      lazyRegistration.resolve({
        id: 'trash',
        labelKey: 'common.nav.trash',
        icon: Trash2,
        placement: 'primary',
        order: 999,
        clientContext: 'firm',
        errorLabel: 'Trash',
        render: () => createElement('div'),
      });
      await lazyRegistration.promise;
    });

    await waitFor(() => {
      expect(
        getKnownAppSurfaceDescriptors().some(({ id }) => id === 'trash')
      ).toBe(true);
    });
    expect(screen.queryByTestId('v1-shell-nav-trash')).not.toBeInTheDocument();
  });
});
