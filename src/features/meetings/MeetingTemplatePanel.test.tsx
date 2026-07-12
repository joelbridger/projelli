import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  renderClientFacingMeetingNote,
  type ClientFacingMeetingNote,
} from '@/platform/meetingTemplates';
import { MeetingTemplatePanel } from './MeetingTemplatePanel';

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
    matterId: 'client-1',
    consent: {
      mode: 'two-party',
      confirmedBy: 'advisor',
      confirmedAt: '2026-07-12T08:59:00.000Z',
    },
  },
};

function makeWorkspace() {
  const files = new Map<string, string>();
  return {
    files,
    workspace: {
      exists: vi.fn((path: string) => Promise.resolve(files.has(path))),
      readFile: vi.fn((path: string) => {
        const value = files.get(path);
        return value === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(value);
      }),
      writeFile: vi.fn((path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      }),
    },
  };
}

function renderPanel(workspace: ReturnType<typeof makeWorkspace>['workspace']) {
  return render(
    <MeetingTemplatePanel
      workspace={workspace}
      firmId="firm-1"
      canManageTemplates
      meetingDir="Clients/Ada/Meetings/2026-07-12-review"
      transcript={transcript}
      clientName="Ada"
      getProvider={() => Promise.resolve({
        send: () => Promise.resolve({
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
      })}
    />
  );
}

describe('MeetingTemplatePanel', () => {
  it('creates, fills, reviews, and persists an internal template without a client-facing note, including after a restart', async () => {
    const { files, workspace } = makeWorkspace();
    const first = renderPanel(workspace);

    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-empty')).toBeInTheDocument();
    });
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
      expect(screen.getByTestId('meeting-template-fill')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('meeting-template-fill'));
    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-review')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('meeting-template-internal-only')
    ).toHaveTextContent('cannot be saved as a client-facing note');
    expect(screen.queryByText('Client-facing')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('meeting-template-save-reviewed'));

    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-notice')).toHaveTextContent(
        'Internal note saved.'
      );
    });
    const saved = JSON.parse(
      files.get('Clients/Ada/Meetings/2026-07-12-review/template-notes.json') ??
        '{}'
    ) as {
      internal?: Record<string, unknown>;
      clientFacing?: Record<string, unknown>;
    };
    expect(Object.keys(saved.internal ?? {})).toHaveLength(1);
    expect(saved.clientFacing).toEqual({});
    // Saved internal JSON has no client-facing capability. This remains true
    // after a fresh component mount, when the in-memory capability set is gone.
    expect(() =>
      renderClientFacingMeetingNote(
        saved.internal as unknown as ClientFacingMeetingNote,
        'Leak attempt'
      )
    ).toThrow(
      'Refused to render a meeting note without client-facing capability.'
    );

    // A component remount stands in for closing and reopening the meeting.
    first.unmount();
    renderPanel(workspace);
    await waitFor(() => {
      expect(screen.getByTestId('meeting-template-fill')).toBeInTheDocument();
    });
    const restored = JSON.parse(
      files.get('Clients/Ada/Meetings/2026-07-12-review/template-notes.json') ?? '{}'
    ) as { clientFacing?: Record<string, unknown> };
    expect(restored.clientFacing).toEqual({});
  });
});
