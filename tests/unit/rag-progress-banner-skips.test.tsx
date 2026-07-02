/**
 * RagProgressBanner — BUG-099 blocker 3: skip counts must render in the
 * "done" banner so the user sees "Memory ready (N files skipped)" instead
 * of a plain "Memory ready." when some files were skipped.
 */

import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RagStatusSnapshot } from '@/platform/hooks/useRagStatus';

// Stub i18next so the component can render without a real provider.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Minimal stub that handles the keys used in the banner.
      if (key === 'memory.rag-banner.ready') {
        return `Memory ready, indexed ${(opts?.['count'] as number) ?? 0} files.`;
      }
      if (key === 'memory.rag-banner.ready-with-skips') {
        return `Memory ready, indexed ${(opts?.['count'] as number) ?? 0} files (${(opts?.['skipped'] as number) ?? 0} skipped).`;
      }
      if (key === 'memory.pdf-progress') {
        return `Indexing PDFs: ${(opts?.['processed'] as number) ?? 0} / ${(opts?.['total'] as number) ?? 0}. Nothing leaves your machine.`;
      }
      return key;
    },
  }),
}));

// Stub the useRagStatus hook — tests supply their own snapshot.
vi.mock('@/platform/hooks/useRagStatus', () => ({
  useRagStatus: () => ({ status: 'idle', processed: 0, total: 0, currentPath: null, skipped: 0, failed: 0, timedOut: 0, skippedPaths: [] }),
}));

// Stub MemoryService so cancel button wiring doesn't fail.
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { cancelIndexing: vi.fn() },
}));

// Stub OCR progress store.
vi.mock('@/platform/rag/ocrProgressStore', () => ({
  useOcrProgressStore: () => null,
}));

const pdfState = vi.hoisted(() => ({
  progress: null as { processed: number; total: number; currentPath: string | null } | null,
}));
vi.mock('@/platform/rag/pdfIndexProgressStore', () => ({
  usePdfIndexProgressStore: () => pdfState.progress,
}));

import { RagProgressBanner } from '@/platform/rag/ui/RagProgressBanner';

const makeSnap = (overrides: Partial<RagStatusSnapshot>): RagStatusSnapshot => ({
  status: 'idle',
  processed: 0,
  total: 0,
  currentPath: null,
  skipped: 0,
  failed: 0,
  timedOut: 0,
  cleanupFailed: 0,
  skippedPaths: [],
  ...overrides,
});

describe('RagProgressBanner — BUG-099 skip count rendering', () => {
  beforeEach(() => {
    pdfState.progress = null;
  });

  it('shows a plain "Memory ready" label when no files were skipped', () => {
    const snap = makeSnap({ status: 'done', processed: 10, total: 10 });
    const { getByTestId } = render(<RagProgressBanner status={snap} />);
    act(() => {}); // flush the useEffect that sets doneVisible
    const label = getByTestId('rag-progress-banner-ready-label');
    expect(label.textContent).toContain('Memory ready');
    expect(label.textContent).not.toContain('skipped');
  });

  it('shows "(N skipped)" with the INDEXED count (total minus skipped)', () => {
    const snap = makeSnap({
      status: 'done',
      processed: 21,
      total: 21,
      skipped: 2,
      failed: 1,
      timedOut: 1,
    });
    const { getByTestId } = render(<RagProgressBanner status={snap} />);
    act(() => {});
    const label = getByTestId('rag-progress-banner-ready-label');
    // Shows "indexed 19 files (2 skipped)" — not "indexed 21 files"
    expect(label.textContent).toContain('19');
    expect(label.textContent).toContain('2 skipped');
    expect(label.textContent).not.toMatch(/—/); // no em dash
  });

  it('renders nothing when status is idle', () => {
    const snap = makeSnap({ status: 'idle' });
    const { container } = render(<RagProgressBanner status={snap} />);
    act(() => {});
    expect(container.firstChild).toBeNull();
  });

  it('shows PDF indexing progress in the same banner', () => {
    pdfState.progress = {
      processed: 2,
      total: 40,
      currentPath: '/ws/Clients/Acme/Email - DAF grant request spring board meeting.pdf',
    };
    const snap = makeSnap({ status: 'idle' });
    render(<RagProgressBanner status={snap} />);
    expect(screen.getByTestId('rag-pdf-progress').textContent).toContain('2 / 40');
  });
});
