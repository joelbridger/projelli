import { describe, expect, it, vi } from 'vitest';
import {
  makeNotesReviewRepository,
  proposalsFromMeetingSummary,
  type NotesReviewWorkspace,
} from '@/platform/meetingNotesReview/notesReviewDelivery';

function memoryWorkspace(
  initial: Record<string, string> = {}
): NotesReviewWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile(path) {
      const value = files.get(path);
      if (value === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(value);
    },
    writeFile(path, content) {
      files.set(path, content);
      return Promise.resolve();
    },
  };
}

const SUMMARY = [
  'What changed',
  '- The family increased monthly savings.',
  '',
  'Action items',
  '- Start the rollover paperwork.',
  '• Confirm every beneficiary designation.',
  '',
  'Facts worth keeping',
  '- The next review is in fall.',
].join('\n');

describe('notes review delivery', () => {
  it('takes only generated Action items as proposals', () => {
    expect(
      proposalsFromMeetingSummary(
        SUMMARY,
        '/Clients/Webb/Meetings/2026-07-12-review'
      )
    ).toMatchObject([
      { title: 'Start the rollover paperwork.', destination: 'task' },
      { title: 'Confirm every beneficiary designation.', destination: 'task' },
    ]);
  });

  it('writes an approved task once and keeps its receipt after a restart', async () => {
    const workspace = memoryWorkspace();
    const input = {
      workspace,
      meetingDir: '/Clients/Webb/Meetings/2026-07-12-review',
      matterId: 'webb',
      summaryText: SUMMARY,
    };
    const firstRun = makeNotesReviewRepository(input);
    const firstState = await firstRun.load();
    const item = firstState.items[0];
    if (!item) throw new Error('Expected a generated action item.');

    await expect(firstRun.approve(item)).resolves.toEqual({
      status: 'saved',
      message: 'Task saved in Tasks.md.',
    });
    expect(
      workspace.files.get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
    ).toContain('- [ ] Start the rollover paperwork.');

    const restarted = makeNotesReviewRepository(input);
    const restartedState = await restarted.load();
    expect(
      restartedState.items.find((candidate) => candidate.id === item.id)
        ?.receipt
    ).toEqual({
      status: 'saved',
      message: 'Task saved in Tasks.md.',
    });
    await restarted.approve(item);
    expect(
      workspace.files
        .get('/Clients/Webb/Meetings/2026-07-12-review/Tasks.md')
        ?.match(/notes-review:/g)
    ).toHaveLength(1);
  });

  it('records the CRM attempt before sending and returns the provider receipt', async () => {
    const workspace = memoryWorkspace();
    const crm = {
      isConnected: vi.fn().mockResolvedValue(true),
      saveProposal: vi.fn().mockResolvedValue({}),
      prepareProposal: vi.fn().mockResolvedValue({}),
      approveProposal: vi
        .fn()
        .mockResolvedValue({ remoteId: 'crm-42', deduped: false }),
    };
    const repository = makeNotesReviewRepository({
      workspace,
      meetingDir: '/Clients/Webb/Meetings/2026-07-12-review',
      matterId: 'webb',
      summaryText: SUMMARY,
      crm,
      householdKey: '123',
      now: () => '2026-07-12T12:00:00.000Z',
    });
    const item = (await repository.load()).items[0];
    if (!item) throw new Error('Expected a generated action item.');

    await expect(
      repository.approve({ ...item, destination: 'crm' })
    ).resolves.toEqual({
      status: 'sent',
      message: 'CRM update delivered (receipt crm-42).',
    });
    expect(crm.saveProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: 'webb',
        sourceRef: expect.stringContaining('#notes-review:'),
      })
    );
    expect(crm.prepareProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        householdKey: '123',
        requestedAt: '2026-07-12T12:00:00.000Z',
      })
    );
    const savedState: unknown = JSON.parse(
      workspace.files.get(
        '/Clients/Webb/Meetings/2026-07-12-review/notes-review.json'
      ) ?? '{}'
    );
    expect(savedState).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          crmAttempt: expect.objectContaining({
            requestedAt: '2026-07-12T12:00:00.000Z',
          }),
          receipt: expect.objectContaining({ status: 'sent' }),
        }),
      ]),
    });
  });
});
