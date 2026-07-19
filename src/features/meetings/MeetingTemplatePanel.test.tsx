import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  createFirmOwnedMeetingTemplate,
  renderClientFacingMeetingNote,
  type ClientFacingMeetingNote,
} from '@/platform/meetingTemplates';
import {
  createDirectClientMeetingsAdapter,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import {
  MeetingTemplatePanel,
  type MeetingTemplateFillBinding,
  type MeetingTemplatePanelProps,
} from './MeetingTemplatePanel';

const transcript: TranscriptFile = {
  segments: [
    {
      startMs: 12_000,
      endMs: 17_000,
      channel: 'sys',
      speaker: 'Client',
      text: 'We will review the plan.',
    },
  ],
  meta: {
    startedAt: '2026-07-12T09:00:00.000Z',
    durationMs: 17_000,
    matterId: 'matter-shared',
    consent: {
      mode: 'two-party',
      confirmedBy: 'advisor',
      confirmedAt: '2026-07-12T08:59:00.000Z',
    },
  },
};

const clientA = {
  householdRef: 'household-a',
  matterId: 'matter-shared',
  displayName: 'Ada',
} as SealedMeetingClientBoundary;
const clientB = {
  householdRef: 'household-b',
  matterId: 'matter-shared',
  displayName: 'Bea',
} as SealedMeetingClientBoundary;
const clientFolder = '/workspace/Clients/Ada';
const meetingDir = 'Clients/Ada/Meetings/2026-07-12-review';

function makeWorkspace() {
  const files = new Map<string, string>();
  return {
    files,
    workspace: {
      exists: vi.fn((path: string) => Promise.resolve(files.has(path))),
      readFile: vi.fn((path: string) => {
        const value = files.get(path);
        return value === undefined
          ? Promise.reject(new Error('ENOENT'))
          : Promise.resolve(value);
      }),
      writeFile: vi.fn((path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      }),
    },
  };
}

const provider = () =>
  Promise.resolve({
    send: () =>
      Promise.resolve({
        content: JSON.stringify({
          sections: [
            {
              id: 'section-1',
              body: 'Advisor follow-up: confirm the plan.',
              citations: [12_000],
            },
          ],
        }),
      }),
  });

function seedMatter(): void {
  useMatterStore.setState({
    matters: [
      {
        id: clientA.matterId,
        name: 'Shared matter',
        client: 'Ada',
        folderPaths: [clientFolder],
        crmHouseholdKeys: [clientA.householdRef],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
  });
}

async function fillBinding(
  activeClientBoundary: SealedMeetingClientBoundary = clientA,
  getProvider = provider
): Promise<MeetingTemplateFillBinding> {
  seedMatter();
  const adapter = createDirectClientMeetingsAdapter({
    client: clientA,
    getActiveClientBoundary: () => clientA,
    matterFolder: clientFolder,
    scan: () =>
      Promise.resolve({
        meetings: [{ dir: meetingDir, folderName: '2026-07-12-review' }],
        scanFailed: false,
      }),
  });
  const result = await adapter.list();
  const target = adapter.resolveTarget(result, {
    dir: meetingDir,
    folderName: '2026-07-12-review',
  });
  if (!target) throw new Error('Expected an F8 pair-bound target.');
  return {
    activeClientBoundary,
    target,
    transcript,
    clientName: activeClientBoundary.displayName ?? 'Client',
    getProvider,
  };
}

function panelProps(
  workspace: ReturnType<typeof makeWorkspace>['workspace']
): MeetingTemplatePanelProps {
  return {
    workspace,
    firmId: 'firm-1',
    canManageTemplates: true,
  };
}

afterEach(() => {
  cleanup();
  useMatterStore.setState({ matters: [] });
});

describe('MeetingTemplatePanel', () => {
  it('opens and manages the real firm library without any meeting, then fills only after an F11 binding is supplied', async () => {
    const { files, workspace } = makeWorkspace();
    const view = render(<MeetingTemplatePanel {...panelProps(workspace)} />);

    expect(screen.getByTestId('meeting-template-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('meeting-template-fill')).toBeNull();

    fireEvent.click(screen.getByTestId('meeting-template-create'));
    fireEvent.change(screen.getByTestId('meeting-template-name'), {
      target: { value: 'Advisor follow-up' },
    });
    fireEvent.change(
      screen.getByTestId('meeting-template-block-label-section-1'),
      { target: { value: 'Next steps' } }
    );
    fireEvent.change(
      screen.getByTestId('meeting-template-block-instruction-section-1'),
      { target: { value: 'List the advisor follow-up.' } }
    );
    fireEvent.click(screen.getByTestId('meeting-template-save'));

    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-select')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('meeting-template-fill')).toBeNull();

    const fill = await fillBinding();
    view.rerender(
      <MeetingTemplatePanel {...panelProps(workspace)} fill={fill} />
    );
    fireEvent.click(await screen.findByTestId('meeting-template-fill'));
    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-review')).toBeInTheDocument();
    });
    expect(screen.getByTestId('meeting-template-internal-only')).toHaveTextContent(
      'cannot be saved as a client-facing note'
    );
    fireEvent.click(screen.getByTestId('meeting-template-save-reviewed'));

    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-notice')).toHaveTextContent(
        'Internal note saved.'
      );
    });
    const saved = JSON.parse(
      files.get(`${meetingDir}/template-notes.json`) ?? '{}'
    ) as {
      internal?: Record<string, unknown>;
      clientFacing?: Record<string, unknown>;
    };
    expect(Object.keys(saved.internal ?? {})).toHaveLength(1);
    expect(saved.clientFacing).toEqual({});
    expect(() =>
      renderClientFacingMeetingNote(
        saved.internal as unknown as ClientFacingMeetingNote,
        'Leak attempt'
      )
    ).toThrow(
      'Refused to render a meeting note without client-facing capability.'
    );
  });

  it('fails closed for the same matter under a different household before provider or transcript fill runs', async () => {
    const { files, workspace } = makeWorkspace();
    const template = createFirmOwnedMeetingTemplate({
      id: 'template-1',
      firmId: 'firm-1',
      name: 'Advisor follow-up',
      audience: 'internal',
      blocks: [
        {
          id: 'section-1',
          label: 'Next steps',
          instruction: 'List the advisor follow-up.',
          required: true,
        },
      ],
    });
    files.set(
      '.lantern/meeting-templates.json',
      JSON.stringify({ schemaVersion: 1, templates: [template] })
    );
    const getProvider = vi.fn(provider);
    const staleFill = await fillBinding(clientB, getProvider);

    render(
      <MeetingTemplatePanel
        {...panelProps(workspace)}
        fill={staleFill}
      />
    );

    expect(
      await screen.findByTestId('meeting-template-fill-unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-template-fill')).toBeNull();
    expect(screen.queryByTestId('meeting-template-review')).toBeNull();
    expect(getProvider).not.toHaveBeenCalled();
  });

  it('discards an in-flight fill when the F11 pair changes before AI returns', async () => {
    const { files, workspace } = makeWorkspace();
    const template = createFirmOwnedMeetingTemplate({
      id: 'template-1',
      firmId: 'firm-1',
      name: 'Advisor follow-up',
      audience: 'internal',
      blocks: [
        {
          id: 'section-1',
          label: 'Next steps',
          instruction: 'List the advisor follow-up.',
          required: true,
        },
      ],
    });
    files.set(
      '.lantern/meeting-templates.json',
      JSON.stringify({ schemaVersion: 1, templates: [template] })
    );
    let finishFill!: (value: { content: string }) => void;
    const getProvider = vi.fn(() =>
      Promise.resolve({
        send: () =>
          new Promise<{ content: string }>((resolve) => {
            finishFill = resolve;
          }),
      })
    );
    const currentFill = await fillBinding(clientA, getProvider);
    const view = render(
      <MeetingTemplatePanel {...panelProps(workspace)} fill={currentFill} />
    );

    fireEvent.click(await screen.findByTestId('meeting-template-fill'));
    await waitFor(() => {
      expect(getProvider).toHaveBeenCalledTimes(1);
    });
    view.rerender(
      <MeetingTemplatePanel
        {...panelProps(workspace)}
        fill={{ ...currentFill, activeClientBoundary: clientB }}
      />
    );
    finishFill({
      content: JSON.stringify({
        sections: [
          {
            id: 'section-1',
            body: 'Household A private follow-up.',
            citations: [12_000],
          },
        ],
      }),
    });

    expect(
      await screen.findByTestId('meeting-template-fill-unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-template-review')).toBeNull();
    expect(screen.queryByText('Household A private follow-up.')).toBeNull();
    expect(workspace.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('template-notes.json'),
      expect.any(String)
    );
  });

  it('shows translated load failure copy and retries the real library', async () => {
    let shouldFail = true;
    const workspace = {
      exists: vi.fn(() => Promise.resolve(true)),
      readFile: vi.fn(() =>
        shouldFail
          ? Promise.reject(new Error('RAW STORAGE FAILURE'))
          : Promise.resolve(JSON.stringify({ schemaVersion: 1, templates: [] }))
      ),
      writeFile: vi.fn(() => Promise.resolve()),
    };
    render(<MeetingTemplatePanel {...panelProps(workspace)} />);

    const error = await screen.findByTestId('meeting-template-load-error');
    expect(error).toHaveTextContent('Meeting templates could not be loaded.');
    expect(error).not.toHaveTextContent('RAW STORAGE FAILURE');
    shouldFail = false;
    fireEvent.click(screen.getByTestId('meeting-template-retry'));
    expect(await screen.findByTestId('meeting-template-empty')).toBeInTheDocument();
  });

  it('has no matter-only or folder-only fill call shape', () => {
    const { workspace } = makeWorkspace();
    const compileNegativeShapes = () => {
      // @ts-expect-error a fill binding requires F11's active pair AND sealed target.
      const matterOnly: MeetingTemplateFillBinding = {
        activeClientBoundary: clientA,
        transcript,
        clientName: 'Ada',
        getProvider: provider,
      };
      const legacyProps: MeetingTemplatePanelProps = {
        workspace,
        firmId: 'firm-1',
        canManageTemplates: true,
        // @ts-expect-error meetingDir is not a template-library or fill authority.
        meetingDir,
      };
      void matterOnly;
      void legacyProps;
    };
    expect(compileNegativeShapes).toBeTypeOf('function');
  });
});
