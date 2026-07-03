import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookView } from './BookView';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { Matter } from '@/platform/types/matter';

function seed() {
  const m = (id: string, client: string): Matter =>
    ({ id, name: id, client, folderPaths: [`Clients/${client}`], createdAt: '2026-01-01T00:00:00.000Z' }) as Matter;
  useMatterStore.setState({ matters: [m('m-a', 'Alvarez'), m('m-b', 'Bishop')] });
  const built = emptyClientMap('m-a');
  built.lastBuiltAt = '2026-07-01T00:00:00.000Z';
  useClientMapStore.setState({ maps: { 'm-a': built } });
}

describe('BookView', () => {
  beforeEach(seed);
  it('renders one row per active client with completeness and staleness', () => {
    render(<BookView onOpenClient={() => {}} />);
    expect(screen.getByTestId('book-view')).toBeTruthy();
    expect(screen.getAllByTestId(/^book-row-/)).toHaveLength(2);
    expect(screen.getByTestId('book-row-m-b').textContent).toContain('Not built yet');
  });
  it('opens the client hub on row click', () => {
    const open = vi.fn();
    render(<BookView onOpenClient={open} />);
    fireEvent.click(screen.getByTestId('book-row-m-a'));
    expect(open).toHaveBeenCalledWith('m-a');
  });
});
