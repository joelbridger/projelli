// tests/unit/matters/AddCustomSectionForm.error.test.tsx
//
// BUG-107 — a failed custom-section build must NOT leave a permanently-empty
// section or an unhandled rejection. It rolls back the just-added section and
// surfaces a plain-language error. Uses the REAL store; only buildCustomSection
// (the AI populate) is mocked, so the rollback path is exercised end-to-end.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/matters/clientMap/customSection', () => ({ buildCustomSection: buildMock }));

import { AddCustomSectionForm } from '@/features/matters/AddCustomSectionForm';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => {
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
  useClientMapStore.getState().setMap('m1', { ...emptyClientMap('m1'), lastBuiltAt: 't' });
  buildMock.mockReset();
});

describe('AddCustomSectionForm — failed populate (BUG-107)', () => {
  it('rolls back the empty section and shows an error when the AI populate fails', async () => {
    buildMock.mockRejectedValue(new Error('provider down'));

    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance coverage' } });
    fireEvent.click(screen.getByTestId('custom-section-submit'));

    // A visible, plain-language error appears.
    await waitFor(() => expect(screen.getByTestId('custom-section-error')).toBeInTheDocument());

    // No orphaned empty custom section is left behind on the map.
    const custom = useClientMapStore.getState().getMap('m1')!.sections.filter((s) => s.kind === 'custom');
    expect(custom).toHaveLength(0);

    // The title is preserved so the user can retry without retyping.
    expect((screen.getByTestId('custom-section-title') as HTMLInputElement).value).toBe('Insurance coverage');
  });

  it('on success the section is populated and no error shows', async () => {
    buildMock.mockResolvedValue({
      id: 'sid', kind: 'custom', key: 'sid', title: 'Insurance coverage', prompt: 'p', scope: 'matter',
      items: [{ id: 'i1', text: 'Policy limit is $1M', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/p', snippet: 's' }], updatedAt: 't' }],
    });

    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance coverage' } });
    fireEvent.click(screen.getByTestId('custom-section-submit'));

    await waitFor(() => {
      const custom = useClientMapStore.getState().getMap('m1')!.sections.filter((s) => s.kind === 'custom');
      expect(custom).toHaveLength(1);
      expect(custom[0]!.items.map((i) => i.text)).toContain('Policy limit is $1M');
    });
    expect(screen.queryByTestId('custom-section-error')).not.toBeInTheDocument();
  });
});
