import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getHomeWidgetHostDescriptors,
  HomeWidgetHost,
  type HomeSurfaceRuntime,
  type HomeWidgetHostDescriptor,
} from '@/features/home';

function runtime(): HomeSurfaceRuntime {
  return {
    navigation: { setSurface: vi.fn() },
    settings: { open: vi.fn() },
    workspace: { activeMatter: null, rootPath: '/workspace' },
  };
}

function descriptor(
  id: string,
  order: number,
  render: HomeWidgetHostDescriptor['render'] = () => null
): HomeWidgetHostDescriptor {
  return { id, order, render };
}

describe('HomeWidgetHost', () => {
  it('rejects duplicate ids and sorts without changing the supplied list', () => {
    const supplied = [
      descriptor('later', 20),
      descriptor('same-order-first', 10),
      descriptor('earlier', 0),
      descriptor('same-order-second', 10),
    ];

    expect(getHomeWidgetHostDescriptors(supplied).map(({ id }) => id)).toEqual([
      'earlier',
      'same-order-first',
      'same-order-second',
      'later',
    ]);
    expect(supplied.map(({ id }) => id)).toEqual([
      'later',
      'same-order-first',
      'earlier',
      'same-order-second',
    ]);
    expect(() =>
      getHomeWidgetHostDescriptors([
        descriptor('duplicate', 0),
        descriptor('duplicate', 1),
      ])
    ).toThrow('Duplicate Home widget host descriptor id: duplicate');
  });

  it('has no markup and invokes no child work when its default registry is empty', () => {
    const { container } = render(<HomeWidgetHost runtime={runtime()} />);

    expect(getHomeWidgetHostDescriptors()).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });
});
