import { beforeEach, describe, expect, it } from 'vitest';
import { useMatterStore } from './matterStore';

describe('matterStore folder path normalization', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
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
