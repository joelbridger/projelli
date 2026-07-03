// tests/unit/clientMap/panel-audit-threading.test.tsx
//
// Trust-fixes finding #1: buildCustomSection gained an onAuditLog option, but
// it is useless unless the UI actually threads a real audit sink into it.
// This verifies the "+ New section" flow (ClientMapPanel -> AddSectionPanel)
// passes the caller-supplied onAuditLog all the way down to buildCustomSection.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { emptyClientMap } from '@/platform/clientMap/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const buildCustomSectionMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/matters/clientMap/customSection', () => ({
  buildCustomSection: buildCustomSectionMock,
}));

describe('ClientMapPanel — onAuditLog threading into buildCustomSection', () => {
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
});
