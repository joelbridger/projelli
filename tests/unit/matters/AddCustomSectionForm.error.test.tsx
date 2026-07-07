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
    const stored = useClientMapStore.getState().getMap('m1')!;
    const custom = stored.sections.filter((s) => s.kind === 'custom');
    expect(custom).toHaveLength(0);
    expect(stored.editHistory ?? []).toEqual([]);

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

  // D3: generation runs async behind an empty placeholder section. If the user
  // adds their own item to that section before generation resolves, the AI
  // result must merge in alongside it, not replace the section and lose it.
  it('does not clobber a user item added to the section while generation is still in flight (D3)', async () => {
    let resolveBuild!: (v: unknown) => void;
    buildMock.mockImplementation(() => new Promise((resolve) => { resolveBuild = resolve; }));

    render(<AddCustomSectionForm matterId="m1" onAdded={vi.fn()} />);
    fireEvent.change(screen.getByTestId('custom-section-title'), { target: { value: 'Insurance coverage' } });
    fireEvent.click(screen.getByTestId('custom-section-submit'));

    // The empty placeholder section lands synchronously.
    let sectionKey = '';
    await waitFor(() => {
      const custom = useClientMapStore.getState().getMap('m1')!.sections.filter((s) => s.kind === 'custom');
      expect(custom).toHaveLength(1);
      sectionKey = custom[0]!.key;
    });

    // The user adds their own note to the section while the AI populate is
    // still pending — this must survive the eventual merge.
    useClientMapStore.getState().addUserItem('m1', sectionKey, 'User note added during generation');

    resolveBuild({
      id: sectionKey, kind: 'custom', key: sectionKey, title: 'Insurance coverage', prompt: 'p', scope: 'matter',
      items: [{ id: 'ai1', text: 'AI generated fact', origin: 'ai', isAssumption: false, sources: [], updatedAt: 't' }],
    });

    await waitFor(() => {
      const section = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === sectionKey)!;
      expect(section.items.map((i) => i.text)).toContain('AI generated fact');
    });

    const section = useClientMapStore.getState().getMap('m1')!.sections.find((s) => s.key === sectionKey)!;
    expect(section.items.map((i) => i.text)).toContain('User note added during generation');
  });
});
