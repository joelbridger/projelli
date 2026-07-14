import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { MeetingNotesReview } from './MeetingNotesReview';
import type { NotesReviewWorkspace } from './notesReviewDelivery';
import { FileOperationError } from '@/platform/fs/types';

function workspace(): NotesReviewWorkspace & {
  files: Map<string, string>;
  exists(path: string): Promise<boolean>;
} {
  const files = new Map<string, string>();
  return {
    files,
    exists(path) {
      return Promise.resolve(files.has(path));
    },
    readFile(path) {
      const file = files.get(path);
      if (file === undefined)
        return Promise.reject(
          new FileOperationError(
            `Failed to read file: ${path}`,
            path,
            'read',
            new Error(`ENOENT: no such file or directory, open '${path}'`)
          )
        );
      return Promise.resolve(file);
    },
    writeFile(path, content) {
      files.set(path, content);
      return Promise.resolve();
    },
  };
}

describe('MeetingNotesReview', () => {
  it('renders the first-use panel from the real Tauri missing-file error shape', async () => {
    const fs = workspace();
    render(
      <MeetingNotesReview
        meetingDir="/Clients/Webb/Meetings/2026-07-12-review"
        matterId="webb"
        summaryText={
          'Decisions\n- Keep the plan.\n\nAction items\n- Start the rollover paperwork.\n\nFacts worth keeping\n- Fall review.'
        }
        workspaceService={fs}
      />
    );

    const approve = await screen.findByTestId(/^notes-review-approve-action-/);
    expect(screen.getByTestId('notes-review-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-notes-review-error')).not.toBeInTheDocument();
    expect(
      fs.files.get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
    ).toBeUndefined();
    fireEvent.click(approve);

    await waitFor(() => {
      expect(
        screen.getByTestId(/^notes-review-receipt-action-/)
      ).toHaveTextContent('Task saved in Tasks.md.')
    });
    expect(
      fs.files.get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
    ).toContain('Start the rollover paperwork.');
  });

  it('keeps an opaque failed notes-review read out of client-facing summary content', async () => {
    const fs = workspace();
    const leakedError =
      'Failed to read file: clients/Diaz, Michelle/Meetings/2025-08-11-annual-review/notes-review.json';
    fs.readFile = () =>
      Promise.reject(
        new FileOperationError(
          leakedError,
          'clients/Diaz, Michelle/Meetings/2025-08-11-annual-review/notes-review.json',
          'read'
        )
      );

    render(
      <MeetingNotesReview
        meetingDir="clients/Diaz, Michelle/Meetings/2025-08-11-annual-review"
        matterId="diaz-michelle"
        summaryText={
          'Decisions\n- Keep the plan.\n\nAction items\n- Start the rollover paperwork.'
        }
        workspaceService={fs}
      />
    );

    expect(
      await screen.findByTestId(/^notes-review-approve-action-/)
    ).toBeInTheDocument();
    expect(screen.queryByText(leakedError)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('meeting-notes-review-error')
    ).not.toBeInTheDocument();
  });

  it('shows a safe placeholder when an existing review file cannot be read', async () => {
    const fs = workspace();
    const statePath =
      'clients/Diaz, Michelle/Meetings/2025-08-11-annual-review/notes-review.json';
    const leakedError = `Failed to read file: ${statePath}`;
    fs.files.set(statePath, 'unreadable');
    fs.readFile = () => Promise.reject(new Error(leakedError));

    render(
      <MeetingNotesReview
        meetingDir="clients/Diaz, Michelle/Meetings/2025-08-11-annual-review"
        matterId="diaz-michelle"
        summaryText="Action items\n- Start the rollover paperwork."
        workspaceService={fs}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the saved review items.'
    );
    expect(screen.queryByText(leakedError)).not.toBeInTheDocument();
  });
});
