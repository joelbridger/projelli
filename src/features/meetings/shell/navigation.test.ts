import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  resolve: vi.fn(),
  select: vi.fn(),
  readSelection: vi.fn(),
}));

vi.mock('../foundation/contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../foundation/contract')>()),
  resolveMeetingNavigation: seams.resolve,
}));

vi.mock('@/platform/client-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/client-context')>()),
  readSelectionOperationDecision: seams.readSelection,
  requestSharedClientSelection: seams.select,
}));

import { resolveMeetingsSurfaceNavigation } from './navigation';

function runtime() {
  return {
    navigation: {
      setSurface: vi.fn(),
      pushSnapshot: vi.fn(),
    },
  };
}

describe('Meetings surface navigation mapping', () => {
  beforeEach(() => {
    seams.resolve.mockReset();
    seams.select.mockReset();
    seams.readSelection.mockReset();
  });

  it('routes an unavailable meeting to Home without touching selection', async () => {
    seams.resolve.mockResolvedValue({ kind: 'unavailable' });
    const host = runtime();

    await resolveMeetingsSurfaceNavigation('meeting-missing', host);

    expect(host.navigation.pushSnapshot).toHaveBeenCalledTimes(1);
    expect(host.navigation.setSurface).toHaveBeenCalledExactlyOnceWith('home');
    expect(seams.select).not.toHaveBeenCalled();
  });

  it('finishes sanctioned selection before entering Meetings for a linked record', async () => {
    const order: string[] = [];
    const clientBoundary = { opaque: true };
    seams.resolve.mockResolvedValue({ kind: 'linked', clientBoundary });
    seams.select.mockImplementation(() => {
      order.push('selection');
      return Promise.resolve({
        kind: 'selected',
        client: {
          provider: 'wealthbox',
          householdId: 'household-a',
          displayName: 'Household A',
        },
      });
    });
    seams.readSelection.mockImplementation(() => {
      order.push('selection-read');
      return {
        kind: 'matter',
        sourceKind: 'matter',
        matter: { id: 'matter-a' },
        client: {
          provider: 'wealthbox',
          householdId: 'household-a',
          displayName: 'Household A',
        },
      };
    });
    const host = runtime();
    host.navigation.setSurface.mockImplementation(() => order.push('surface'));

    await resolveMeetingsSurfaceNavigation('meeting-linked', host);

    expect(seams.select).toHaveBeenCalledExactlyOnceWith(clientBoundary);
    expect(order).toEqual(['selection', 'selection-read', 'surface']);
    expect(host.navigation.setSurface).toHaveBeenCalledExactlyOnceWith(
      'meetings'
    );
  });

  it('refuses unknown records without routing anywhere', async () => {
    seams.resolve.mockResolvedValue({ kind: 'unknown' });
    const host = runtime();

    await resolveMeetingsSurfaceNavigation('meeting-unknown', host);

    expect(host.navigation.pushSnapshot).not.toHaveBeenCalled();
    expect(host.navigation.setSurface).not.toHaveBeenCalled();
    expect(seams.select).not.toHaveBeenCalled();
  });
});
