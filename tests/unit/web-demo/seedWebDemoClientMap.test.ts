/**
 * seedWebDemoClientMap.test.ts — the public-demo Webb Household seed.
 *
 * Verifies the demo gets a real client to hang the Client Map on, a fully-filled
 * "solid" map cited to the real seeded Webb files, and that the client's hub is
 * focused so the demo boots on the Client Map. Idempotent across reloads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { seedWebDemoClientMap } from '@/web-demo/seedWebDemoClientMap';

const WEBB_ID = 'matter_demo_webb';
const WEBB_DIR = '/lantern-demo/Webb Household';

beforeEach(() => {
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null });
  useClientMapStore.setState({ maps: {} });
});

describe('seedWebDemoClientMap', () => {
  it('creates the Webb client keyed to the seeded demo folder and focuses its hub', async () => {
    await seedWebDemoClientMap();

    const matter = useMatterStore.getState().matters.find((m) => m.id === WEBB_ID);
    expect(matter).toBeTruthy();
    expect(matter!.client).toBe('Marcus & Tanya Webb');
    expect(matter!.folderPaths).toContain(WEBB_DIR);

    // Boots on the Client Map: the client is active and its hub is open.
    expect(useMatterStore.getState().activeMatterId).toBe(WEBB_ID);
    expect(useMatterStore.getState().clientMapHubId).toBe(WEBB_ID);
  });

  it('seeds a fully-filled, cited "solid" Client Map (no open gaps, no assumptions)', async () => {
    await seedWebDemoClientMap();
    const map = useClientMapStore.getState().getMap(WEBB_ID);
    expect(map).toBeTruthy();
    expect(map!.completeness.level).toBe('solid');
    expect(map!.completeness.ask).toEqual([]);
    expect(map!.completeness.assuming).toEqual([]);
    expect(map!.completeness.know.length).toBeGreaterThan(0);

    // Every one of the four core sections (Household · Goals · Money and
    // accounts · Follow-ups) is populated.
    expect(map!.sections).toHaveLength(4);
    for (const section of map!.sections) {
      expect(section.items.length).toBeGreaterThan(0);
    }

    // Every citation points at a real seeded Webb file, so the [source] chips
    // open the actual demo documents.
    const sources = map!.sections.flatMap((s) => s.items.flatMap((i) => i.sources));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((src) => src.kind === 'document' && src.ref.startsWith(`${WEBB_DIR}/`))).toBe(true);
  });

  it('is idempotent — a reload re-focuses the same single client + map', async () => {
    await seedWebDemoClientMap();
    await seedWebDemoClientMap();
    expect(useMatterStore.getState().matters.filter((m) => m.id === WEBB_ID)).toHaveLength(1);
    expect(useClientMapStore.getState().getMap(WEBB_ID)).toBeTruthy();
  });
});
