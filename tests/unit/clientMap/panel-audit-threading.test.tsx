// tests/unit/clientMap/panel-audit-threading.test.tsx
//
// Trust-fixes finding #1: buildCustomSection gained an onAuditLog option, but
// it is useless unless the UI actually threads a real audit sink into it.
// This verifies the "+ New section" flow (ClientMapPanel -> AddSectionPanel)
// passes the caller-supplied onAuditLog all the way down to buildCustomSection.

import '@/i18n';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { emptyClientMap } from '@/platform/clientMap/types';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

const buildCustomSectionMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/matters/clientMap/customSection', () => ({
  buildCustomSection: buildCustomSectionMock,
}));

describe('ClientMapPanel — onAuditLog threading into buildCustomSection', () => {
  beforeEach(() => {
    useClientMapStore.setState({ maps: {} });
    localStorage.clear();
    buildCustomSectionMock.mockReset();
  });

  it('passes the panel-level onAuditLog through to buildCustomSection when a new section is created', async () => {
    buildCustomSectionMock.mockResolvedValue({
      id: 'sec-x', kind: 'custom', key: 'sec-x', title: 'Insurance', scope: 'matter', items: [],
    });
    const onAuditLog = vi.fn();
    const map = emptyClientMap('matter_demo_x');
    render(
      <ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} onAuditLog={onAuditLog} />,
    );

    fireEvent.click(screen.getByTestId('clientmap-tab-add'));
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance' } });
    fireEvent.click(screen.getByTestId('custom-section-submit'));

    await waitFor(() => {
      expect(buildCustomSectionMock).toHaveBeenCalled();
    });
    const call = buildCustomSectionMock.mock.calls[0]!;
    expect(call[4]).toEqual({ onAuditLog });
  });

  it('rolls back a failed new section without writing section-removed history', async () => {
    buildCustomSectionMock.mockRejectedValue(new Error('provider down'));
    const map = emptyClientMap('matter_demo_x');
    map.editHistory = [];
    useClientMapStore.getState().setMap(map.matterId, map);
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.click(screen.getByTestId('clientmap-tab-add'));
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance' } });
    fireEvent.click(screen.getByTestId('custom-section-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Could not fill this section/i)).toBeInTheDocument();
    });

    const stored = useClientMapStore.getState().getMap(map.matterId)!;
    expect(stored.sections.filter((s) => s.kind === 'custom')).toHaveLength(0);
    expect(stored.editHistory).toEqual([]);
  });

  it('adds a bullet to the active built-in section', () => {
    const map = emptyClientMap('matter_demo_x');
    useClientMapStore.getState().setMap(map.matterId, map);
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.click(screen.getByTestId('clientmap-add-fact-row'));
    fireEvent.change(screen.getByTestId('clientmap-add-bullet-input'), {
      target: { value: 'Client wants to retire in 2028' },
    });
    fireEvent.click(screen.getByTestId('clientmap-add-bullet-submit'));

    expect(
      useClientMapStore
        .getState()
        .getMap(map.matterId)!
        .sections.find((s) => s.key === 'household')!
        .items.map((i) => i.text),
    ).toContain('Client wants to retire in 2028');
  });

  it('asks before removing a bullet', async () => {
    const map = emptyClientMap('matter_demo_x');
    map.sections[0]!.items.push({
      id: 'i1',
      text: 'Remove me',
      origin: 'user',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    useClientMapStore.getState().setMap(map.matterId, map);
    render(<ClientMapPanel map={map} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);

    fireEvent.pointerDown(screen.getByTestId('clientmap-item-menu'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('clientmap-item-remove'));
    expect(screen.getByTestId('clientmap-confirm-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(
        useClientMapStore
          .getState()
          .getMap(map.matterId)!
          .sections.find((s) => s.key === 'household')!
          .items,
      ).toHaveLength(0);
    });
  });
});
