// tests/unit/matters/ClientMapUpdatesTray.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapUpdatesTray } from '@/features/matters/ClientMapUpdatesTray';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  const m = emptyClientMap('m1');
  useClientMapStore.setState({ maps: { m1: m } });
  useClientMapStore.getState().setPendingUpdates('m1', [
    { id: 'u1', sectionKey: 'standing', op: 'add', draft: { id: 'd1', text: 'New filing due', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' }, reason: 'r', createdAt: 't' },
  ]);
});

describe('ClientMapUpdatesTray', () => {
  it('shows the marker and accepting applies the update', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    expect(screen.getByTestId('clientmap-updates-marker')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('clientmap-update-accept'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.sections.find((s) => s.key === 'standing')!.items.map((i) => i.text)).toContain('New filing due');
    expect(map.pendingUpdates).toHaveLength(0);
  });

  it('dismiss drops the update without applying it', () => {
    render(<ClientMapUpdatesTray matterId="m1" />);
    fireEvent.click(screen.getByTestId('clientmap-update-dismiss'));
    const map = useClientMapStore.getState().getMap('m1')!;
    expect(map.pendingUpdates).toHaveLength(0);
    expect(map.sections.find((s) => s.key === 'standing')!.items).toHaveLength(0);
  });
});
