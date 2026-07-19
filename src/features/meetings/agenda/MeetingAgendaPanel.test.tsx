import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from '../foundation/contract';
import type { MeetingPanelContext } from '../meetingWorkspaceTypes';
import type {
  MeetingAgenda,
  MeetingAgendaReadResult,
  MeetingAgendaStore,
} from './meetingAgendaStore';

const { copyAgenda, exportAgenda } = vi.hoisted(() => ({
  copyAgenda: vi.fn(() => Promise.resolve()),
  exportAgenda: vi.fn(() => Promise.resolve({ kind: 'saved' as const })),
}));

vi.mock('../noticeClipboard', () => ({ copyText: copyAgenda }));
vi.mock('../agendaExport', () => ({
  exportPersistedAgendaToWord: exportAgenda,
}));

import { MeetingAgendaPanel } from './MeetingAgendaPanel';

const labels: Record<string, string> = {
  'meetings.agenda.exact-meeting-required': 'Exact meeting required',
  'meetings.agenda.loading': 'Loading agenda',
  'meetings.agenda.empty': 'No saved agenda',
  'meetings.agenda.start-draft': 'Start blank agenda',
  'meetings.agenda.draft-created': 'Agenda draft saved.',
  'meetings.agenda.template': 'Template',
  'meetings.agenda.editor-label': 'Meeting agenda',
  'meetings.agenda.placeholder': 'Add topics',
  'meetings.agenda.save-draft': 'Save draft',
  'meetings.agenda.saved': 'Draft saved.',
  'meetings.agenda.copy-share': 'Copy to share',
  'meetings.agenda.copied': 'Saved agenda copied.',
  'meetings.agenda.export-word': 'Export Word',
  'meetings.agenda.exported': 'Saved agenda exported.',
  'meetings.agenda.export-cancelled': 'Export cancelled.',
  'meetings.agenda.save-before-sharing': 'Save before sharing',
};

function client(
  householdRef = 'household-1',
  matterId = 'matter-1'
): SealedMeetingClientBoundary {
  return { householdRef, matterId } as SealedMeetingClientBoundary;
}

function meeting(id = 'meeting-1', boundary = client()): MeetingProjection {
  return {
    id,
    workspaceId: 'workspace-1',
    householdRef: boundary.householdRef,
    matterId: boundary.matterId,
    typeId: 'review',
    ownerRef: 'member-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'scheduled',
    references: ['document-1'],
  };
}

function context(id = 'meeting-1', boundary = client()): MeetingPanelContext {
  return {
    t: ((key: string, options?: { count?: number }) =>
      key === 'meetings.agenda.sources'
        ? `${String(options?.count ?? 0)} saved sources`
        : (labels[key] ?? key)) as MeetingPanelContext['t'],
    canonicalMeeting: meeting(id, boundary),
    clientBoundary: boundary,
    clientName: 'Henderson Family',
  } as MeetingPanelContext;
}

function agenda(body: string, revision = 1, id = 'meeting-1'): MeetingAgenda {
  return {
    id: `agenda-${id}`,
    meetingId: id,
    householdRef: 'household-1',
    matterId: 'matter-1',
    body,
    template: {
      kind: 'built-in',
      templateId: 'blank-agenda',
      version: 1,
      label: 'Blank agenda',
    },
    sources: [{ kind: 'meeting-reference', sourceRef: 'document-1' }],
    revision,
    createdAt: '2026-07-19T09:00:00.000Z',
    updatedAt: '2026-07-19T09:00:00.000Z',
  };
}

function store(
  overrides: Partial<MeetingAgendaStore> = {}
): MeetingAgendaStore {
  return {
    read: vi.fn<MeetingAgendaStore['read']>(() =>
      Promise.resolve({ kind: 'empty' })
    ),
    create: vi.fn<MeetingAgendaStore['create']>(() =>
      Promise.resolve({ kind: 'ready', agenda: agenda('') })
    ),
    save: vi.fn<MeetingAgendaStore['save']>((_target, input) =>
      Promise.resolve({
        kind: 'ready',
        agenda: agenda(input.body, input.expectedRevision + 1),
      })
    ),
    ...overrides,
  };
}

describe('MeetingAgendaPanel', () => {
  it('creates a persisted draft, edits it, and exposes provenance plus only real local actions', async () => {
    copyAgenda.mockClear();
    exportAgenda.mockClear();
    const agendaStore = store();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock inspection does not invoke the method.
    const createDraft = vi.mocked(agendaStore.create);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock inspection does not invoke the method.
    const saveDraft = vi.mocked(agendaStore.save);
    render(<MeetingAgendaPanel context={context()} store={agendaStore} />);

    expect(
      await screen.findByTestId('meeting-agenda-empty')
    ).toBeInTheDocument();
    expect(screen.queryByText(/send/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('meeting-agenda-start-draft'));

    const editor = await screen.findByTestId('meeting-agenda-editor');
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: 'meeting-1' })
    );
    expect(screen.getByTestId('meeting-agenda-provenance')).toHaveTextContent(
      'Blank agenda v1'
    );
    expect(screen.getByTestId('meeting-agenda-provenance')).toHaveTextContent(
      '1 saved sources'
    );

    fireEvent.change(editor, {
      target: { value: '## Topics\n\n- Review the plan' },
    });
    expect(screen.getByTestId('meeting-agenda-copy-share')).toBeDisabled();
    expect(screen.getByTestId('meeting-agenda-export-word')).toBeDisabled();
    expect(
      screen.getByTestId('meeting-agenda-save-before-sharing')
    ).toBeVisible();

    fireEvent.click(screen.getByTestId('meeting-agenda-save-draft'));
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: 'meeting-1' }),
        { body: '## Topics\n\n- Review the plan', expectedRevision: 1 }
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('meeting-agenda-copy-share')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('meeting-agenda-copy-share'));
    await waitFor(() => {
      expect(copyAgenda).toHaveBeenCalledWith('## Topics\n\n- Review the plan');
    });
    fireEvent.click(screen.getByTestId('meeting-agenda-export-word'));
    await waitFor(() => {
      expect(exportAgenda).toHaveBeenCalledWith({
        body: '## Topics\n\n- Review the plan',
        clientLabel: 'Henderson Family',
      });
    });
  });

  it('rejects a late load result after the exact meeting changes', async () => {
    const resolvers = new Map<
      string,
      (result: MeetingAgendaReadResult) => void
    >();
    const agendaStore = store({
      read: vi.fn<MeetingAgendaStore['read']>(
        (target) =>
          new Promise<Awaited<ReturnType<MeetingAgendaStore['read']>>>(
            (resolve) => {
              resolvers.set(target.meetingId, resolve);
            }
          )
      ),
    });
    const view = render(
      <MeetingAgendaPanel context={context('meeting-1')} store={agendaStore} />
    );
    view.rerender(
      <MeetingAgendaPanel context={context('meeting-2')} store={agendaStore} />
    );

    resolvers.get('meeting-1')?.({
      kind: 'ready',
      agenda: agenda('OLD MEETING TEXT', 1, 'meeting-1'),
    });
    expect(screen.getByTestId('meeting-agenda-loading')).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('OLD MEETING TEXT')
    ).not.toBeInTheDocument();

    resolvers.get('meeting-2')?.({
      kind: 'ready',
      agenda: agenda('NEW MEETING TEXT', 1, 'meeting-2'),
    });
    expect(
      await screen.findByDisplayValue('NEW MEETING TEXT')
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('OLD MEETING TEXT')
    ).not.toBeInTheDocument();
  });

  it('shows a local typed error and does not read without exact canonical identity', async () => {
    const agendaStore = store();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock inspection does not invoke the method.
    const readAgenda = vi.mocked(agendaStore.read);
    render(
      <MeetingAgendaPanel
        context={{ ...context(), canonicalMeeting: null, clientBoundary: null }}
        store={agendaStore}
      />
    );

    expect(await screen.findByTestId('meeting-agenda-error')).toHaveTextContent(
      'Exact meeting required'
    );
    expect(readAgenda).not.toHaveBeenCalled();
  });
});
