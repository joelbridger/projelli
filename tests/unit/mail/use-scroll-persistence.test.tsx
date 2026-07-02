/**
 * Perf (P2.2) fix — Codex review round 2: `useScrollPersistence` must
 * restore/save correctly even when its target scroll container is
 * CONDITIONALLY rendered (e.g. EmailWorkspace's results box, hidden during
 * loading/error/empty states) rather than always mounted.
 *
 * The original implementation was a plain `useRef` + a `useEffect` keyed
 * only on the matter-derived storage key, which ran (and captured
 * `current`) once, immediately on mount — fine when the target was ALWAYS
 * present, broken once the target could mount late or disappear and
 * reappear. A callback ref fires exactly when the DOM node actually
 * attaches/detaches, so restore/save happen at the right moment regardless
 * of how many times the target appears and disappears.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollPersistence } from '@/features/email/useScrollPersistence';
import type { Matter } from '@/platform/types/matter';

function Harness({
  activeMatter,
  showBox,
  resultsKey = 'default',
}: {
  activeMatter: Matter | null;
  showBox: boolean;
  resultsKey?: string;
}) {
  const { scrollContainerRef, getInitialScrollOffset } = useScrollPersistence(activeMatter, resultsKey);
  if (!showBox) {
    return <div data-testid="loading-placeholder">Loading...</div>;
  }
  return (
    <div
      ref={scrollContainerRef}
      data-testid="scroll-box"
      data-initial-offset={getInitialScrollOffset()}
      style={{ overflow: 'auto', height: 100 }}
    />
  );
}

const MATTER: Matter = {
  id: 'matter-1',
  name: 'Acme v. Beta',
  client: 'Acme Corp',
  folderPaths: [],
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('useScrollPersistence — conditionally-rendered scroll container', () => {
  it('restores a saved scroll position even when the container mounts LATE (after loading)', () => {
    sessionStorage.setItem('email-scroll-all', '250');

    const { rerender, getByTestId } = render(<Harness activeMatter={null} showBox={false} />);
    // Still "loading" — the scroll box doesn't exist yet. Nothing should throw.
    expect(() => getByTestId('loading-placeholder')).not.toThrow();

    // Data loads — the box mounts for the first time.
    rerender(<Harness activeMatter={null} showBox={true} />);
    const box = getByTestId('scroll-box') as HTMLDivElement;
    expect(box.scrollTop).toBe(250);
  });

  it('saves the scroll position when the container unmounts (e.g. a new search starts loading)', () => {
    const { rerender, getByTestId } = render(<Harness activeMatter={null} showBox={true} />);
    const box = getByTestId('scroll-box') as HTMLDivElement;
    box.scrollTop = 500;

    // The results box disappears (e.g. a new search shows the loading state).
    rerender(<Harness activeMatter={null} showBox={false} />);

    expect(sessionStorage.getItem('email-scroll-all')).toBe('500');
  });

  it('restores again if the container unmounts and remounts within the same matter', () => {
    sessionStorage.setItem('email-scroll-all', '100');
    const { rerender, getByTestId } = render(<Harness activeMatter={null} showBox={true} />);
    (getByTestId('scroll-box') as HTMLDivElement).scrollTop = 100;

    rerender(<Harness activeMatter={null} showBox={false} />);
    expect(sessionStorage.getItem('email-scroll-all')).toBe('100');

    // A retry re-fetches and the box reappears.
    rerender(<Harness activeMatter={null} showBox={true} />);
    const boxAgain = getByTestId('scroll-box') as HTMLDivElement;
    expect(boxAgain.scrollTop).toBe(100);
  });

  it('keeps per-matter keys independent', () => {
    sessionStorage.setItem('email-scroll-matter-1', '75');
    sessionStorage.setItem('email-scroll-all', '999');

    const { getByTestId } = render(<Harness activeMatter={MATTER} showBox={true} />);
    const box = getByTestId('scroll-box') as HTMLDivElement;
    expect(box.scrollTop).toBe(75);
  });

  // Codex review (P2.2, round 8): a new search/filter change must NOT
  // restore an old deep scroll position into the fresh result set — that
  // can hide the very results the user just asked for below the fold.
  it('a resultsKey change resets scroll to the top instead of restoring the old position', () => {
    sessionStorage.setItem('email-scroll-all', '5000');

    const { rerender, getByTestId } = render(
      <Harness activeMatter={null} showBox={true} resultsKey="query-a" />,
    );
    // Real navigation (mount for the FIRST time under this results key) —
    // restoring the saved position here is correct (it's the same logical
    // "browse all mail" view the user was in before).
    expect((getByTestId('scroll-box') as HTMLDivElement).scrollTop).toBe(5000);

    // The user scrolls deep into these results, then types a new query —
    // the results box unmounts (loading) and remounts with fresh data.
    (getByTestId('scroll-box') as HTMLDivElement).scrollTop = 4000;
    rerender(<Harness activeMatter={null} showBox={false} resultsKey="query-a" />);
    rerender(<Harness activeMatter={null} showBox={true} resultsKey="query-b" />);

    const freshBox = getByTestId('scroll-box') as HTMLDivElement;
    expect(freshBox.scrollTop).toBe(0);
    expect(freshBox.dataset['initialOffset']).toBe('0');
  });

  it('a retry (same resultsKey) after the results-key reset still restores normally', () => {
    const { rerender, getByTestId } = render(
      <Harness activeMatter={null} showBox={true} resultsKey="query-a" />,
    );
    rerender(<Harness activeMatter={null} showBox={false} resultsKey="query-b" />);
    rerender(<Harness activeMatter={null} showBox={true} resultsKey="query-b" />);
    (getByTestId('scroll-box') as HTMLDivElement).scrollTop = 300;

    // An error causes a retry of the SAME query — the box unmounts and
    // remounts again, but resultsKey hasn't changed this time, so the
    // scroll position from moments ago should be preserved.
    rerender(<Harness activeMatter={null} showBox={false} resultsKey="query-b" />);
    rerender(<Harness activeMatter={null} showBox={true} resultsKey="query-b" />);

    expect((getByTestId('scroll-box') as HTMLDivElement).scrollTop).toBe(300);
  });

  it('getInitialScrollOffset falls back to 0 for a corrupted/non-numeric saved value', () => {
    sessionStorage.setItem('email-scroll-all', 'not-a-number');

    const { getByTestId } = render(<Harness activeMatter={null} showBox={true} />);
    const box = getByTestId('scroll-box') as HTMLDivElement;
    // Must not be NaN (which would break a virtualizer's internal math) —
    // falls back to a safe, valid 0 instead.
    expect(box.dataset['initialOffset']).toBe('0');
    // scrollTop restore is similarly guarded — never set to NaN.
    expect(box.scrollTop).not.toBeNaN();
  });
});
