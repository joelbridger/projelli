import { beforeEach, describe, expect, it } from 'vitest';
import { useMatterStore } from './matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

describe('matterStore folder path normalization', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('dedupes folder paths when setting them', () => {
    const matter = useMatterStore.getState().createMatter({ name: 'Hollings', client: 'Hollings' });

    useMatterStore.getState().setFolderPaths(matter.id, [
      'C:/workspaces/Northcrest/Clients/Hollings Family/',
      'C:\\workspaces\\Northcrest\\Clients\\Hollings Family',
    ]);

    expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings Family',
    ]);
  });

  it('dedupes folder paths when adding them', () => {
    const matter = useMatterStore.getState().createMatter({ name: 'Hollings', client: 'Hollings' });

    useMatterStore.getState().addFolderPath(matter.id, 'C:/workspaces/Northcrest/Clients/Hollings Family/');
    useMatterStore.getState().addFolderPath(matter.id, 'C:\\workspaces\\Northcrest\\Clients\\Hollings Family');

    expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual([
      'C:/workspaces/Northcrest/Clients/Hollings Family',
    ]);
  });

  describe('write-time canonicalization to ABSOLUTE (the choke-point)', () => {
    it('resolves a workspace-relative folder to absolute using the open workspace root', () => {
      useWorkspaceStore.setState({ rootPath: 'C:/workspaces/Northcrest' });
      const matter = useMatterStore.getState().createMatter({ name: 'Reyes', client: 'Reyes' });

      // This mirrors the real bug: the CRM auto-backfill sources candidate
      // folders from the file tree's own workspace-RELATIVE node paths.
      useMatterStore.getState().addFolderPath(matter.id, 'Clients/Reyes Household');

      expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual([
        'C:/workspaces/Northcrest/Clients/Reyes Household',
      ]);
    });

    it('leaves a relative folder relative when no workspace root is open yet', () => {
      // No rootPath set — matches app bootstrap before a workspace is opened.
      const matter = useMatterStore.getState().createMatter({
        name: 'Reyes',
        client: 'Reyes',
        folderPaths: ['Clients/Reyes Household'],
      });
      expect(matter.folderPaths).toEqual(['Clients/Reyes Household']);
    });

    it('never stringifies a non-string entry — drops it instead of writing "[object Object]"', () => {
      const matter = useMatterStore.getState().createMatter({
        name: 'Reyes',
        client: 'Reyes',
        // A folder-picker object leaking through, exactly like the 2026-07-01
        // "Creating in [object Object]/" QA bug.
        folderPaths: [{ path: '/ws/RealFolder' } as unknown as string, { garbage: true } as unknown as string],
      });
      expect(matter.folderPaths).toEqual(['/ws/RealFolder']);
      expect(matter.folderPaths.join()).not.toContain('[object Object]');
    });

    it('setFolderPaths canonicalizes relative entries the same way', () => {
      useWorkspaceStore.setState({ rootPath: '/home/jane/WS' });
      const matter = useMatterStore.getState().createMatter({ name: 'Reyes', client: 'Reyes' });
      useMatterStore.getState().setFolderPaths(matter.id, ['Clients/Reyes']);
      expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual([
        '/home/jane/WS/Clients/Reyes',
      ]);
    });

    it('handles Windows drive paths, UNC roots, mixed slashes, trailing separators, and drive-letter case drift', () => {
      useWorkspaceStore.setState({ rootPath: 'C:\\WS\\' });
      const matter = useMatterStore.getState().createMatter({ name: 'Windows', client: 'Windows' });
      useMatterStore.getState().setFolderPaths(matter.id, [
        'Clients\\Acme\\',
        'c:/WS/Clients/Acme/', // already-absolute, drive-case-drifted, trailing slash
        '\\\\Server\\Share\\Clients\\Beta',
      ]);
      const paths = useMatterStore.getState().matters[0]?.folderPaths ?? [];
      // The relative entry resolves under root; the already-absolute
      // drive-case-drifted entry is recognized as absolute via `isAbsolutePath`
      // and passed through UNCHANGED rather than re-joined into a doubled path
      // (the exact bug `p.startsWith(rootPath)` naive checks produce). Cross-
      // entry case-insensitive de-duplication of the volume root is a separate,
      // pre-existing concern of `dedupeFolderPaths`'s Set-based identity check,
      // not something this write-time shape fix changes.
      expect(paths).toContain('//Server/Share/Clients/Beta');
      expect(paths).toContain('C:/WS/Clients/Acme');
      expect(paths).toContain('c:/WS/Clients/Acme');
      expect(paths.some((p) => p.includes('WS/c:') || p.includes('WS\\c:'))).toBe(false);
    });

    it('removeFolderPath compares canonically so a relative remove matches an absolute stored path', () => {
      useWorkspaceStore.setState({ rootPath: 'C:/WS' });
      const matter = useMatterStore.getState().createMatter({
        name: 'Reyes',
        client: 'Reyes',
        folderPaths: ['Clients/Reyes'],
      });
      expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual(['C:/WS/Clients/Reyes']);
      useMatterStore.getState().removeFolderPath(matter.id, 'Clients/Reyes');
      expect(useMatterStore.getState().matters[0]?.folderPaths).toEqual([]);
    });
  });

  it('initializes new connector mapping fields when creating a matter', () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Hollings',
      client: 'Hollings',
      boxFolderKeys: ['box-a', 'box-a', ''],
      jotformKeys: ['form-a'],
      sharefileFolderKeys: ['sf-a'],
      zocksKeys: ['zocks-a'],
      addeparKeys: ['addepar-a'],
    });

    expect(matter.boxFolderKeys).toEqual(['box-a']);
    expect(matter.jotformKeys).toEqual(['form-a']);
    expect(matter.sharefileFolderKeys).toEqual(['sf-a']);
    expect(matter.zocksKeys).toEqual(['zocks-a']);
    expect(matter.addeparKeys).toEqual(['addepar-a']);
  });
});
