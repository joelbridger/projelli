import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Home } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

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

import { SurfaceLoadingFallback } from '@/app/shell/common/SurfaceLoadingFallback';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';

function RegistryHarness() {
  const state = useAppSurfaceRegistry();

  if (!state.ready) return <SurfaceLoadingFallback />;
  if (state.error) return <div role="alert">{state.error.message}</div>;
  return <div>Registry ready</div>;
}

afterEach(() => {
  cleanup();
});

describe('useAppSurfaceRegistry lazy registration', () => {
  it('shows the loading fallback and re-validates duplicates after a lazy surface resolves', async () => {
    const { container } = render(<RegistryHarness />);

    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await act(async () => {
      lazyRegistration.resolve({
        id: 'home',
        labelKey: 'lazy.home',
        icon: Home,
        placement: 'hidden',
        order: 99,
        clientContext: 'firm',
        errorLabel: 'Lazy duplicate',
        render: () => createElement('div'),
      });
      await lazyRegistration.promise;
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'duplicate surface id: home'
    );
  });
});
