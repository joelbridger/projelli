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
});
