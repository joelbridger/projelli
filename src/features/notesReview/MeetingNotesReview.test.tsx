import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { MeetingNotesReview } from './MeetingNotesReview';
import type { NotesReviewWorkspace } from './notesReviewDelivery';

function workspace(): NotesReviewWorkspace & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(path) {
      const file = files.get(path);
      if (file === undefined) throw new Error(`ENOENT: ${path}`);
      return file;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
  };
}

describe('MeetingNotesReview', () => {
  it('renders a real meeting action and writes it only after its approve click', async () => {
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
    expect(
      fs.files.get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
    ).toBeUndefined();
    fireEvent.click(approve);

    await waitFor(() =>
      expect(
        screen.getByTestId(/^notes-review-receipt-action-/)
      ).toHaveTextContent('Task saved in Tasks.md.')
    );
    expect(
      fs.files.get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
    ).toContain('Start the rollover paperwork.');
  });
});
