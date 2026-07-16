import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  HomeWidgetHost,
  type HomeSurfaceRuntime,
  type HomeWidgetHostDescriptor,
} from '@/features/home';

function FixturePersonalizationHost({
  runtime,
}: {
  runtime: HomeSurfaceRuntime;
}) {
  const descriptors: readonly HomeWidgetHostDescriptor[] = [
    {
      id: 'fixture-later',
      order: 20,
      render: ({ runtime: receivedRuntime }) => (
        <span data-testid="fixture-later">
          {receivedRuntime === runtime ? 'same runtime' : 'different runtime'}
        </span>
      ),
    },
    {
      id: 'fixture-earlier',
      order: 10,
      render: ({ runtime: receivedRuntime }) => (
        <span data-testid="fixture-earlier">
          {receivedRuntime === runtime ? 'same runtime' : 'different runtime'}
        </span>
      ),
    },
  ];

  return <HomeWidgetHost descriptors={descriptors} runtime={runtime} />;
}

describe('HomeWidgetHost public consumer', () => {
  it('lets a feature-owned host render ordered widgets through the public Home doorway', () => {
    const runtime: HomeSurfaceRuntime = {
      navigation: { setSurface: vi.fn() },
      settings: { open: vi.fn() },
      workspace: { activeMatter: null, rootPath: '/workspace' },
    };
    const { container } = render(
      <FixturePersonalizationHost runtime={runtime} />
    );

    expect(
      [...container.querySelectorAll('span')].map(
        (element) => element.getAttribute('data-testid')
      )
    ).toEqual(['fixture-earlier', 'fixture-later']);
    expect(screen.getByTestId('fixture-earlier')).toHaveTextContent(
      'same runtime'
    );
    expect(screen.getByTestId('fixture-later')).toHaveTextContent(
      'same runtime'
    );
  });
});
