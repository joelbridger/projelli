// tests/unit/matters/ClientMapUpdatesTray.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  useClientMapStore.setState({ maps: { m1: m } });
  useClientMapStore.getState().setPendingUpdates('m1', [
    { id: 'u1', sectionKey: 'money', op: 'add', draft: { id: 'd1', text: 'New filing due', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' }, reason: 'r', createdAt: 't' },
  ]);
});

describe('ClientMapUpdatesTray', () => {
  it('shows the marker and accepting applies the update', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    expect(screen.getByTestId('clientmap-updates-marker')).toHaveTextContent('1');
    expect(screen.getByText('1 update to review')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('clientmap-update-accept'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'money')!.items.map((i) => i.text)).toContain('New filing due');
    expect(map.pendingUpdates).toHaveLength(0);
  });

  it('dismiss drops the update without applying it', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    fireEvent.click(screen.getByTestId('clientmap-update-dismiss'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.pendingUpdates).toHaveLength(0);
    expect(map.sections.find((s) => s.key === 'money')!.items).toHaveLength(0);
  });

  it('asks for the same remove-bullet confirmation before accepting a remove update', async () => {
    const map = emptyClientMap('m1');
    map.sections.find((s) => s.key === 'money')!.items.push({
      id: 'remove-me',
      text: 'Outdated account note',
      origin: 'ai',
      isAssumption: false,
      sources: [],
      updatedAt: 't',
    });
    useClientMapStore.setState({ maps: { m1: map } });
    useClientMapStore.getState().setPendingUpdates('m1', [
      { id: 'remove-update', sectionKey: 'money', op: 'remove', itemId: 'remove-me', reason: 'stale', createdAt: 't' },
    ]);

    render(<ClientMapUpdatesTray matterId="m1" />);
    fireEvent.click(screen.getByTestId('clientmap-update-accept'));

    expect(await screen.findByTestId('clientmap-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove this bullet?')).toBeInTheDocument();
    expect(
      useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === 'money')!.items,
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      const after = useClientMapStore.getState().getMap('m1')!;
      expect(after.sections.find((s) => s.key === 'money')!.items).toHaveLength(0);
      expect(after.pendingUpdates).toHaveLength(0);
    });
  });

  it('uses the exact pending count instead of saying a few', () => {
    useClientMapStore.getState().setPendingUpdates('m1', Array.from({ length: 12 }, (_, i) => ({
      id: `u-${String(i)}`,
      sectionKey: i % 2 === 0 ? 'money' : 'household',
      op: 'add' as const,
      draft: { id: `d-${String(i)}`, text: `Manual review item ${String(i)}`, origin: 'ai' as const, isAssumption: false, sources: [], updatedAt: 't' },
      reason: 'r',
      createdAt: 't',
    })));

    render(<ClientMapUpdatesTray matterId="m1" />);

    expect(screen.getByTestId('clientmap-updates-marker')).toHaveTextContent('12');
    expect(screen.getByText('12 updates to review')).toBeInTheDocument();
    expect(screen.queryByText('a few updates to review')).not.toBeInTheDocument();
    expect(screen.getByText('Show 4 more')).toBeInTheDocument();
  });
});
