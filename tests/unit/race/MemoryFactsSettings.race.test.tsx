/**
 * QA-58 (P1/P2) — MemoryFactsSettings stale-async workspace guard.
 *
 * Scenario: refresh() reads getFactsService() for workspace A and awaits
 * listFacts(). The workspace switches to B (the singleton now returns B's
 * service). If A's slow listFacts resolves last, its result must be DROPPED —
 * never render workspace A's memory facts inside workspace B's settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

import { MemoryFactsSettings } from '@/features/settings/MemoryFactsSettings';
import type { Fact, FactsServiceApi } from '@/platform/rag/FactsService';
import { setFactsServiceForTests, getFactsService } from '@/platform/rag/factsSingleton';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function fact(id: string, text: string): Fact {
  return { id, text, created: '2026-07-01T00:00:00.000Z', approved_by: 'user' };
}

function makeSvc(overrides: Partial<FactsServiceApi>): FactsServiceApi {
  return {
    loadFacts: vi.fn(async () => []),
    saveFacts: vi.fn(async () => {}),
    addFact: vi.fn(async () => fact('x', 'x')),
    updateFact: vi.fn(async () => fact('x', 'x')),
    deleteFact: vi.fn(async () => true),
    listFacts: vi.fn(async () => []),
    ...overrides,
  } as FactsServiceApi;
}

beforeEach(() => {
  setFactsServiceForTests(null);
});

describe('MemoryFactsSettings — QA-58 stale-async workspace isolation', () => {
  it('drops a slow listFacts result from workspace A after the service switches to B', async () => {
    const aList = deferred<Fact[]>();
    const svcA = makeSvc({ listFacts: vi.fn(() => aList.promise) });
    const svcB = makeSvc({
      listFacts: vi.fn(async () => [fact('b1', 'Workspace B fact')]),
      addFact: vi.fn(async () => fact('b2', 'added')),
    });

    setFactsServiceForTests(svcA);
    // No initialFacts → the component uses the getFactsService() singleton path.
    render(<MemoryFactsSettings />);
    // A's refresh is now in flight (listFacts pending).

    // Workspace switches to B; trigger B's refresh via a manual add.
    setFactsServiceForTests(svcB);
    expect(getFactsService()).toBe(svcB);
    const input = screen.getByTestId('settings-facts-add-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new fact' } });
    fireEvent.click(screen.getByTestId('settings-facts-add'));
    await waitFor(() => { expect(screen.getByText('Workspace B fact')).toBeTruthy(); });

    // A's slow list resolves LATE with A's private facts.
    await act(async () => {
      aList.resolve([fact('a1', 'Workspace A SECRET fact')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Workspace A's fact must never render inside workspace B's settings.
    expect(screen.queryByText('Workspace A SECRET fact')).toBeNull();
    expect(screen.getByText('Workspace B fact')).toBeTruthy();
  });
});
