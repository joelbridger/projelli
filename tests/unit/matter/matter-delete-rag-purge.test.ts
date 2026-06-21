/**
 * Matter-delete AI-trace purge. Deleting a matter must wipe the AI's memory of
 * it while keeping the user's files (product decision, BUG-042):
 *   - BUG-040: purge its chunks from the local RAG index (so its content can't
 *     resurface through all-matters retrieval, which applies no matter filter).
 *   - BUG-042: clear every email's durable "filed to this matter" override (so
 *     the next sync can't re-tag emails with a matter that no longer exists).
 * This guards both wirings from deleteMatter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ragDeleteMatterMock } = vi.hoisted(() => ({ ragDeleteMatterMock: vi.fn(async () => {}) }));
vi.mock('@/platform/utils/tauri-commands', async (importActual) => {
  const actual = await importActual<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, ragDeleteMatter: ragDeleteMatterMock };
});

const { mailClearMatterFilingsMock } = vi.hoisted(() => ({
  mailClearMatterFilingsMock: vi.fn(async () => 0),
}));
vi.mock('@/platform/utils/mail-commands', async (importActual) => {
  const actual = await importActual<typeof import('@/platform/utils/mail-commands')>();
  return { ...actual, mailClearMatterFilings: mailClearMatterFilingsMock };
});

import { useMatterStore } from '@/platform/matter/matterStore';

describe('deleteMatter — RAG purge (BUG-040)', () => {
  beforeEach(() => {
    ragDeleteMatterMock.mockClear();
    mailClearMatterFilingsMock.mockClear();
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('purges the deleted matter from the RAG index', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    useMatterStore.getState().deleteMatter(m.id);

    expect(ragDeleteMatterMock).toHaveBeenCalledTimes(1);
    expect(ragDeleteMatterMock).toHaveBeenCalledWith(m.id);
    // and the matter is gone from state
    expect(useMatterStore.getState().matters.find((x) => x.id === m.id)).toBeUndefined();
  });

  it('does not purge any OTHER matter', async () => {
    const a = useMatterStore.getState().createMatter({ name: 'A', client: 'CA' });
    const b = useMatterStore.getState().createMatter({ name: 'B', client: 'CB' });
    useMatterStore.getState().deleteMatter(a.id);

    expect(ragDeleteMatterMock).toHaveBeenCalledTimes(1);
    expect(ragDeleteMatterMock).toHaveBeenCalledWith(a.id);
    expect(ragDeleteMatterMock).not.toHaveBeenCalledWith(b.id);
  });

  it('clears the deleted matter’s email filings (BUG-042)', async () => {
    const m = useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    useMatterStore.getState().deleteMatter(m.id);

    expect(mailClearMatterFilingsMock).toHaveBeenCalledTimes(1);
    expect(mailClearMatterFilingsMock).toHaveBeenCalledWith(m.id);
  });

  it('does not clear email filings for any OTHER matter', async () => {
    const a = useMatterStore.getState().createMatter({ name: 'A', client: 'CA' });
    const b = useMatterStore.getState().createMatter({ name: 'B', client: 'CB' });
    useMatterStore.getState().deleteMatter(a.id);

    expect(mailClearMatterFilingsMock).toHaveBeenCalledTimes(1);
    expect(mailClearMatterFilingsMock).toHaveBeenCalledWith(a.id);
    expect(mailClearMatterFilingsMock).not.toHaveBeenCalledWith(b.id);
  });
});
