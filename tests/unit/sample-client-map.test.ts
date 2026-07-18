/**
 * First-run sample Client Map seed (P0-1).
 *
 * Proves that seeding the advisor sample leaves the user in a POPULATED Client
 * Map — the core "see value in minute one" goal — rather than an empty app:
 *   - the hand-authored Hendricks map has all four core sections, each with
 *     cited items;
 *   - every citation points at one of the real `Sample - *.md` workspace files
 *     (workspace-relative, so the source chips resolve cross-platform);
 *   - seedSampleClientMap stores it and opens its hub as the active matter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { hendricksClientMap, seedSampleClientMap } from '@/platform/matter/samples/sampleClientMap';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { CORE_SECTION_ORDER } from '@/platform/clientMap/types';

const SAMPLE_FILES = new Set([
  'Sample - Household Overview.md',
  'Sample - Account Summary.md',
  'Sample - Meeting Notes.md',
  'Sample - Plan Summary.md',
  'Sample - Email Thread.md',
  'Sample - Beneficiary & Estate Notes.md',
]);

describe('sample Client Map seed (Hendricks)', () => {
  beforeEach(() => {
    useClientMapStore.getState().clearAll();
    localStorage.clear();
  });

  it('builds a solid map covering all four core sections with cited items', () => {
    const map = hendricksClientMap('matter_test');
    expect(map.completeness.level).toBe('solid');
    // All four core sections present and ordered.
    expect(map.sections.map((s) => s.key)).toEqual(CORE_SECTION_ORDER);
    // Every core section has at least one item, and every item is cited.
    for (const section of map.sections) {
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.text.length).toBeGreaterThan(0);
        expect(item.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it('cites only the real sample workspace files (relative refs)', () => {
    const map = hendricksClientMap('matter_test');
    const refs = map.sections.flatMap((s) => s.items.flatMap((i) => i.sources.map((src) => src.ref)));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      // Relative filename (no embedded path separators) -> cross-platform.
      expect(ref.includes('/')).toBe(false);
      expect(ref.includes('\\')).toBe(false);
      expect(SAMPLE_FILES.has(ref)).toBe(true);
    }
  });

  it('seedSampleClientMap stores the map and opens its hub as the active matter', async () => {
    // The caller (App) creates the sample matter first (getOrCreateSampleMatter);
    // mirror that so setActiveMatter has a real matter to activate.
    useMatterStore.getState().createMatter({
      id: 'matter_sample_test',
      name: 'The Hendricks Household',
      client: 'The Hendricks Household',
      folderPaths: ['/ws'],
      isSample: true,
    });
    await seedSampleClientMap('matter_sample_test');
    const stored = useClientMapStore.getState().getMap('matter_sample_test');
    expect(stored).toBeTruthy();
    expect(stored?.sections.length).toBe(4);
    const matterState = useMatterStore.getState();
    expect(matterState.activeMatterId).toBe('matter_sample_test');
    expect(matterState.clientMapHubId).toBe('matter_sample_test');
  });
});
