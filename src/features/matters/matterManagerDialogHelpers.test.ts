import { describe, expect, it } from 'vitest';
import { dedupeFolderPathsForDisplay, folderPathsMatch } from './matterManagerDialogHelpers';

describe('matter folder path helpers', () => {
  it('matches mapped folders across absolute, relative, and slash-style spellings', () => {
    expect(folderPathsMatch(
      'C:\\workspaces\\Northcrest\\Clients\\Hollings Family',
      'Clients/Hollings Family/',
      'C:/workspaces/Northcrest',
    )).toBe(true);
  });

  it('dedupes displayed folders by workspace-relative path', () => {
    expect(dedupeFolderPathsForDisplay(
      [
        'C:/workspaces/Northcrest/Clients/Hollings Family',
        'Clients\\Hollings Family\\',
      ],
      'C:/workspaces/Northcrest',
    )).toEqual(['C:/workspaces/Northcrest/Clients/Hollings Family']);
  });
});
