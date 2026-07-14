import { describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import {
  makeNotesReviewRepository,
  proposalsFromMeetingSummary,
  type NotesReviewWorkspace,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
import { markdownToDocxBytes } from '@/platform/utils/docx-io';

function memoryWorkspace(
  initial: Record<string, string> = {}
): NotesReviewWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists(path) {
      return Promise.resolve(files.has(path));
    },
    readFile(path) {
      const value = files.get(path);
      if (value === undefined)
        return Promise.reject(new Error(`ENOENT: ${path}`));
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

  it('finds Word-native bullets produced by the meeting-notes DOCX pipeline', async () => {
    const bytes = await markdownToDocxBytes(
      [
        '# Meeting summary',
        '',
        '## What changed',
        '- The family increased monthly savings.',
        '',
        '## Action items',
        '- Start the rollover paperwork.',
        '- Confirm every beneficiary designation.',
        '- Book the tax-planning call.',
        '',
        '## Facts worth keeping',
        '- The next review is in fall.',
      ].join('\n'),
      'notes.docx'
    );
    // Vitest loads Mammoth's Node entry point, while the app loads its browser
    // entry point. Both use the same DOCX conversion and raw-text extraction;
    // only the input key differs (`buffer` here, `arrayBuffer` in the app).
    const input = { buffer: Buffer.from(bytes) };
    const [htmlResult, textResult] = await Promise.all([
      mammoth.convertToHtml(input),
      mammoth.extractRawText(input),
    ]);
    const extracted = {
      html: htmlResult.value,
      plainText: textResult.value,
    };

    expect(extracted.plainText).toContain(
      'Action items\n\nStart the rollover paperwork.'
    );
    expect(extracted.plainText).not.toMatch(
      /[-*•]\s+Start the rollover paperwork\./
    );
    expect(extracted.html).toMatch(
      /<h2>Action items<\/h2>\s*<ul>\s*<li>Start the rollover paperwork\.<\/li>/
    );
    expect(
      proposalsFromMeetingSummary(
        extracted.plainText,
        '/Clients/Webb/Meetings/2026-07-12-review',
        extracted.html
      )
    ).toMatchObject([
      { title: 'Start the rollover paperwork.', destination: 'task' },
      { title: 'Confirm every beneficiary designation.', destination: 'task' },
      { title: 'Book the tax-planning call.', destination: 'task' },
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
