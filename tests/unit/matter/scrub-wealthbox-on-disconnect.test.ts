/**
 * Phase B / B1 — after a Wealthbox disconnect, no Wealthbox-derived data may
 * persist in local matters. `scrubWealthboxFromMatters`:
 *   - deletes pure-CRM matters (no user files/mail);
 *   - scrubs the imported name/client on CRM-created matters the user has since
 *     added content to (so the Wealthbox name no longer persists), keeping content;
 *   - just unlinks household keys from user matters merely linked to a household;
 *   - invalidates the at-a-glance cache for every affected matter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ragDeleteMatterMock } = vi.hoisted(() => ({ ragDeleteMatterMock: vi.fn(async () => {}) }));
vi.mock('@/platform/utils/tauri-commands', async (importActual) => {
  const actual = await importActual<typeof import('@/platform/utils/tauri-commands')>();
  return { ...actual, ragDeleteMatter: ragDeleteMatterMock };
});
const { mailClearMatterFilingsMock } = vi.hoisted(() => ({ mailClearMatterFilingsMock: vi.fn(async () => 0) }));
vi.mock('@/platform/utils/mail-commands', async (importActual) => {
  const actual = await importActual<typeof import('@/platform/utils/mail-commands')>();
  return { ...actual, mailClearMatterFilings: mailClearMatterFilingsMock };
});

import { useMatterStore } from '@/platform/matter/matterStore';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';

const emptyGlance: MatterAtAGlanceResult = { openIssues: [], deadlines: [], upcomingDates: [], nextActions: [], generatedAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => {
  useMatterStore.setState({ matters: [], activeMatterId: null, cache: {}, snapshots: {}, statusByMatterId: {} });
});

describe('scrubWealthboxFromMatters (B1)', () => {
  it('deletes a pure-CRM matter (no user files/mail)', () => {
    const store = useMatterStore.getState();
    const pure = store.createMatter({ name: 'Ellison, Robert & Margaret', client: 'Ellison, Robert & Margaret', crmHouseholdKeys: ['hh-1'], createdFromCrm: true });
    store.scrubWealthboxFromMatters();
    expect(useMatterStore.getState().matters.find((m) => m.id === pure.id)).toBeUndefined();
  });

  it('scrubs the imported Wealthbox name on a CRM-created matter the user added a folder to', () => {
    const store = useMatterStore.getState();
    const mixed = store.createMatter({
      name: 'Hollings Family',
      client: 'Hollings Family',
      folderPaths: ['/Clients/Hollings Documents'],
      crmHouseholdKeys: ['hh-2'],
      createdFromCrm: true,
    });
    // It had an at-a-glance summary built (possibly from Wealthbox data).
    store.setEntry(mixed.id, emptyGlance);

    store.scrubWealthboxFromMatters();

    const after = useMatterStore.getState().matters.find((m) => m.id === mixed.id)!;
    expect(after).toBeDefined();                       // content kept
    expect(after.name).not.toBe('Hollings Family');    // Wealthbox name scrubbed
    expect(after.client).not.toBe('Hollings Family');
    expect(after.name).toBe('Hollings Documents');     // neutral, folder-derived
    expect(after.crmHouseholdKeys ?? []).toEqual([]);  // household keys removed
    expect(after.createdFromCrm).toBe(false);          // CRM origin cleared
    expect(after.folderPaths).toEqual(['/Clients/Hollings Documents']); // user content intact
    // at-a-glance cache cleared (may have been built from Wealthbox data).
    expect(useMatterStore.getState().getEntry(mixed.id)).toBeUndefined();
  });

  it('only unlinks household keys from a user matter merely linked to a household (name kept)', () => {
    const store = useMatterStore.getState();
    const linked = store.createMatter({
      name: 'My Own Client',
      client: 'Acme Corp',
      folderPaths: ['/Clients/Acme'],
      crmHouseholdKeys: ['hh-3'],
      // not createdFromCrm — the user named this matter
    });
    store.scrubWealthboxFromMatters();
    const after = useMatterStore.getState().matters.find((m) => m.id === linked.id)!;
    expect(after.name).toBe('My Own Client');          // user name untouched
    expect(after.client).toBe('Acme Corp');
    expect(after.crmHouseholdKeys ?? []).toEqual([]);  // keys removed
  });

  it('leaves non-CRM matters completely untouched', () => {
    const store = useMatterStore.getState();
    const plain = store.createMatter({ name: 'No CRM Here', client: 'No CRM Here', folderPaths: ['/x'] });
    store.scrubWealthboxFromMatters();
    const after = useMatterStore.getState().matters.find((m) => m.id === plain.id)!;
    expect(after.name).toBe('No CRM Here');
  });
});
