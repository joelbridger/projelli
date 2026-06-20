import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJourney } from './useJourney';
import type { Chapter, JourneyData } from './types';

// ---------------------------------------------------------------------------
// Stub chapters used across tests
// ---------------------------------------------------------------------------
const alwaysOpenChapter: Chapter = {
  id: 'ch-open',
  title: 'Open',
  render: () => null as unknown as ReturnType<Chapter['render']>,
};

const gatedChapter: Chapter = {
  id: 'ch-gated',
  title: 'Gated',
  canAdvance: (data: JourneyData) => !!data.displayName,
  render: () => null as unknown as ReturnType<Chapter['render']>,
};

const finalChapter: Chapter = {
  id: 'ch-final',
  title: 'Final',
  render: () => null as unknown as ReturnType<Chapter['render']>,
};

const THREE_CHAPTERS: Chapter[] = [alwaysOpenChapter, gatedChapter, finalChapter];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeHook(chapters: Chapter[] = THREE_CHAPTERS, reducedMotion = false) {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const result = renderHook(() =>
    useJourney(chapters, { reducedMotion, onComplete, onSkip }),
  );
  return { ...result, onComplete, onSkip };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useJourney – advance', () => {
  it('starts at index 0', () => {
    const { result } = makeHook();
    expect(result.current.index).toBe(0);
  });

  it('advance moves to the next chapter', () => {
    const { result } = makeHook();
    act(() => result.current.advance());
    expect(result.current.index).toBe(1);
  });

  it('advance does NOT move past the last chapter on its own', () => {
    const { result } = makeHook([alwaysOpenChapter, finalChapter]);
    act(() => result.current.advance());
    // now at index 1 (last) — advance should be a no-op without calling complete
    act(() => result.current.advance());
    expect(result.current.index).toBe(1);
  });

  it('canAdvance=false blocks advance', () => {
    const { result } = makeHook();
    // Chapter at index 0 has no gate — advance to chapter 1 (gated)
    act(() => result.current.advance());
    expect(result.current.index).toBe(1);
    // displayName is not set → canAdvance returns false
    act(() => result.current.advance());
    expect(result.current.index).toBe(1); // blocked
  });

  it('canAdvance gate passes after setData satisfies it', () => {
    const { result } = makeHook();
    act(() => result.current.advance()); // to ch-gated at index 1
    act(() => result.current.setData({ displayName: 'Alice' }));
    act(() => result.current.advance()); // gate should pass now
    expect(result.current.index).toBe(2);
  });
});

describe('useJourney – goBack', () => {
  it('goBack moves to the previous chapter', () => {
    const { result } = makeHook();
    act(() => result.current.advance());
    expect(result.current.index).toBe(1);
    act(() => result.current.goBack());
    expect(result.current.index).toBe(0);
  });

  it('goBack never goes below 0', () => {
    const { result } = makeHook();
    act(() => result.current.goBack());
    expect(result.current.index).toBe(0);
    act(() => result.current.goBack());
    expect(result.current.index).toBe(0);
  });
});

describe('useJourney – skipAll', () => {
  it('skipAll calls onSkip with the current data', () => {
    const { result, onSkip } = makeHook();
    act(() => result.current.setData({ displayName: 'Bob' }));
    act(() => result.current.skipAll());
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Bob' }));
  });

  it('skipAll does not call onComplete', () => {
    const { result, onComplete, onSkip } = makeHook();
    act(() => result.current.skipAll());
    expect(onComplete).not.toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

describe('useJourney – complete', () => {
  it('complete calls onComplete with the current data', () => {
    const { result, onComplete } = makeHook();
    act(() => result.current.setData({ displayName: 'Carol' }));
    act(() => result.current.complete());
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Carol' }));
  });

  it('complete does not call onSkip', () => {
    const { result, onSkip, onComplete } = makeHook();
    act(() => result.current.complete());
    expect(onSkip).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe('useJourney – setData', () => {
  it('setData merges patch into existing data', () => {
    const { result } = makeHook();
    act(() => result.current.setData({ displayName: 'Dave' }));
    act(() => result.current.setData({ emailConnected: true }));
    expect(result.current.data).toMatchObject({
      displayName: 'Dave',
      emailConnected: true,
    });
  });
});

describe('useJourney – isFirst / isLast', () => {
  it('isFirst is true at index 0', () => {
    const { result } = makeHook();
    expect(result.current.isFirst).toBe(true);
  });

  it('isFirst is false after advancing', () => {
    const { result } = makeHook();
    act(() => result.current.advance());
    expect(result.current.isFirst).toBe(false);
  });

  it('isLast is false at index 0', () => {
    const { result } = makeHook();
    expect(result.current.isLast).toBe(false);
  });

  it('isLast is true at the final chapter', () => {
    const { result } = makeHook([alwaysOpenChapter, finalChapter]);
    act(() => result.current.advance());
    expect(result.current.isLast).toBe(true);
  });
});

describe('useJourney – current', () => {
  it('current matches the chapter at the current index', () => {
    const { result } = makeHook();
    expect(result.current.current.id).toBe('ch-open');
    act(() => result.current.advance());
    expect(result.current.current.id).toBe('ch-gated');
  });
});
