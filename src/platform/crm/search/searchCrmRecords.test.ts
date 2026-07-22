import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setWorkspace: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => boundary.invoke(...args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (...args: unknown[]) => boundary.setWorkspace(...args),
}));

import { searchCrmRecords } from './searchCrmRecords';

describe('CRM native search allow boundary', () => {
  beforeEach(() => {
    boundary.invoke.mockReset().mockResolvedValue([]);
    boundary.setWorkspace.mockReset().mockResolvedValue(undefined);
  });

  it('passes only exact, unique visible record IDs to the native command', async () => {
    await searchCrmRecords('/workspace', 'retirement', 'matter-a', [
      'note-a',
      'note-a',
      ' note-b ',
      '',
    ]);

    expect(boundary.invoke).toHaveBeenCalledWith('crm_search', {
      query: 'retirement',
      matterId: 'matter-a',
      allowedRecordIds: ['note-a'],
    });
  });

  it('does not open or query native search when no record is currently visible', async () => {
    await expect(
      searchCrmRecords('/workspace', 'retirement', undefined, [])
    ).resolves.toEqual([]);
    expect(boundary.setWorkspace).not.toHaveBeenCalled();
    expect(boundary.invoke).not.toHaveBeenCalled();
  });
});
