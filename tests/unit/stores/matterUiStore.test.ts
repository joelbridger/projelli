import { describe, it, expect, beforeEach } from 'vitest';
import { useMatterUiStore, isWorkingSurface } from '@/platform/matter/matterUiStore';

describe('matterUiStore — per-matter UI memory', () => {
  beforeEach(() => {
    useMatterUiStore.setState({ snapshots: {} });
  });

  it('saves and retrieves a per-matter snapshot', () => {
    useMatterUiStore.getState().saveSnapshot('m1', { surface: 'search', activeTabPath: null });
    expect(useMatterUiStore.getState().getSnapshot('m1')).toEqual({ surface: 'search', activeTabPath: null });
  });

  it('remembers the focused document for the Documents surface', () => {
    useMatterUiStore.getState().saveSnapshot('m2', { surface: 'files', activeTabPath: '/m2/brief.docx' });
    expect(useMatterUiStore.getState().getSnapshot('m2')?.activeTabPath).toBe('/m2/brief.docx');
  });

  it('keeps each matter independent (returning to one does not show the others)', () => {
    useMatterUiStore.getState().saveSnapshot('a', { surface: 'search', activeTabPath: null });
    useMatterUiStore.getState().saveSnapshot('b', { surface: 'email', activeTabPath: null });
    expect(useMatterUiStore.getState().getSnapshot('a')?.surface).toBe('search');
    expect(useMatterUiStore.getState().getSnapshot('b')?.surface).toBe('email');
  });

  it('returns undefined for a matter with no snapshot (first visit)', () => {
    expect(useMatterUiStore.getState().getSnapshot('never')).toBeUndefined();
  });

  it('clears a snapshot', () => {
    useMatterUiStore.getState().saveSnapshot('m', { surface: 'workflows', activeTabPath: null });
    useMatterUiStore.getState().clearSnapshot('m');
    expect(useMatterUiStore.getState().getSnapshot('m')).toBeUndefined();
  });

  it('only remembers real working surfaces, not the hub or settings', () => {
    expect(isWorkingSurface('search')).toBe(true);
    expect(isWorkingSurface('files')).toBe(true);
    expect(isWorkingSurface('email')).toBe(true);
    expect(isWorkingSurface('workflows')).toBe(true);
    expect(isWorkingSurface('audit')).toBe(true);
    expect(isWorkingSurface('matters')).toBe(false);
    expect(isWorkingSurface('settings')).toBe(false);
  });
});
