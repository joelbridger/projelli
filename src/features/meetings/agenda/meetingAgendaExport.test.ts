import { beforeEach, describe, expect, it, vi } from 'vitest';

const { markdownToDocxBytes, saveFile } = vi.hoisted(() => ({
  markdownToDocxBytes: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  saveFile: vi.fn(() =>
    Promise.resolve('/chosen/Agenda.docx' as string | undefined)
  ),
}));

vi.mock('@/platform/utils/docx-io', () => ({ markdownToDocxBytes }));
vi.mock('@/platform/utils/saveFile', () => ({ saveFile }));

import { exportPersistedAgendaToWord } from '../agendaExport';

describe('persisted agenda export seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveFile.mockResolvedValue('/chosen/Agenda.docx');
  });

  it('accepts saved content rather than a path and uses the real Word save picker', async () => {
    await expect(
      exportPersistedAgendaToWord({
        body: '## Topics\n\n- Review beneficiary choices',
        clientLabel: '../Henderson:Family',
      })
    ).resolves.toEqual({
      kind: 'saved',
      path: '/chosen/Agenda.docx',
    });

    expect(markdownToDocxBytes).toHaveBeenCalledWith(
      '## Topics\n\n- Review beneficiary choices',
      'Agenda - Henderson-Family.docx',
      {}
    );
    expect(saveFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        suggestedName: 'Agenda - Henderson-Family.docx',
      })
    );
  });

  it('refuses an empty agenda instead of creating a pretend export', async () => {
    await expect(
      exportPersistedAgendaToWord({ body: '   ', clientLabel: 'Client' })
    ).rejects.toThrow('Add agenda text before exporting.');
    expect(saveFile).not.toHaveBeenCalled();
  });
});
