import '@/i18n';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spine } from './Spine';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

function seed() {
  const m = (id: string, client: string, archived = false): Matter =>
    ({ id, name: id, client, folderPaths: [`Clients/${client}`], createdAt: '2026-01-01T00:00:00.000Z', archived }) as Matter;
  useMatterStore.setState({
    matters: [m('m-a', 'Alvarez'), m('m-b', 'Bishop'), m('m-c', 'Carver', true)],
    activeMatterId: null,
  });
}

describe('Spine sidebar client list', () => {
  beforeEach(seed);

  it('lists active clients but excludes archived ones', () => {
    render(<Spine />);
    // Rule: the client name is never repeated as a separate subtext line —
    // matterLabel() folds it into the one-line label ("Client - Name" when
    // the internal name differs from the client, or just the name/client
    // when they match), so the client's name is still visible right here.
    expect(screen.getByText(/Alvarez/)).toBeTruthy();
    expect(screen.getByText(/Bishop/)).toBeTruthy();
    expect(screen.queryByText(/Carver/)).toBeNull();
  });

  it('falls back to the "+ New client" empty state once every client is archived', () => {
    useMatterStore.setState({
      matters: [
        { id: 'm-a', name: 'm-a', client: 'Alvarez', folderPaths: [], createdAt: '2026-01-01T00:00:00.000Z', archived: true } as Matter,
      ],
      activeMatterId: null,
    });
    render(<Spine />);
    expect(screen.queryByText(/Alvarez/)).toBeNull();
    expect(screen.getAllByTestId('spine-new-client').length).toBeGreaterThan(0);
  });
});
