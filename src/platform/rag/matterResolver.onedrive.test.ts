/**
 * OneDrive folder -> matter resolution.
 *
 * Mirrors the Wealthbox household matcher, but OneDrive is safer by default:
 * it never creates matters from folders. A folder either reuses an existing
 * link, links to one unambiguous same-name matter, or stays unassigned.
 */

import { describe, expect, it } from 'vitest';
import {
  buildOneDriveFolderKey,
  resolveMatterForOneDriveFolder,
} from './matterResolver';
import type { Matter } from '@/platform/types/matter';

function makeMatter(
  overrides: Pick<Matter, 'id' | 'name' | 'client'> & Partial<Matter>
): Matter {
  return {
    folderPaths: [],
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

function folder(name: string, path = `/Clients/${name}`) {
  return {
    driveId: 'drive-northcrest',
    name,
    path,
  };
}

const NORTHCREST_CLIENT_NAMES = [
  'Caldwell, Jennifer',
  'Diaz, Michelle',
  'Diaz, Sandra',
  'Ellison, Robert & Margaret',
  'Foster, Ronald & Linda',
  'Greer, Carol & Anthony',
  'Hollings Family',
  'Jennings, Carol',
  'Jennings, Robert',
  'Koch, Linda & Paul',
  'Koch, Nancy & Nancy',
  'Lambert, Angela',
  'Lambert, Emily & Kevin',
  'Mercer, Deborah & Ruth',
  'Nakamura, David & Susan',
  'Patel, Priya',
  'Pruitt, Jeffrey & Kimberly',
  'Quinn, George & Carol',
  'Quinn, Patricia & Kevin',
  'Sutton, Mark & George',
  'Underwood, Daniel & Emily',
  'Underwood, Donna & Karen',
  'Underwood, Laura & Emily',
  'Voss, Eleanor',
  'Webb, Marcus & Tanya',
  'York, Gary & Deborah',
];

describe('buildOneDriveFolderKey', () => {
  it('builds the backend folder-key shape from drive/site/path', () => {
    expect(
      buildOneDriveFolderKey({
        driveId: 'drive-a',
        path: '/Clients/Patel, Priya/',
      })
    ).toBe('m365/default/drive-a:/clients/patel, priya');
    expect(
      buildOneDriveFolderKey({
        driveId: 'drive-a',
        siteId: 'site-1',
        path: 'root:/Clients/Acme',
      })
    ).toBe('m365/default/site-1/drive-a:/clients/acme');
  });
});

describe('resolveMatterForOneDriveFolder', () => {
  it('links an exact unambiguous demo folder name to the matching matter', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'matter-webb',
        name: 'Webb, Marcus & Tanya',
        client: 'Webb, Marcus & Tanya',
      }),
      makeMatter({
        id: 'matter-patel',
        name: 'Patel, Priya',
        client: 'Patel, Priya',
      }),
    ];

    expect(
      resolveMatterForOneDriveFolder(matters, folder('Webb, Marcus & Tanya'))
    ).toEqual({
      matterId: 'matter-webb',
      action: 'link',
      name: 'Webb, Marcus & Tanya',
    });
    expect(
      resolveMatterForOneDriveFolder(matters, folder('Patel, Priya'))
    ).toEqual({
      matterId: 'matter-patel',
      action: 'link',
      name: 'Patel, Priya',
    });
  });

  it('does not link when two matters share the same normalized name', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'm1',
        name: 'Hollings Family',
        client: 'Hollings Family',
      }),
      makeMatter({
        id: 'm2',
        name: 'HOLLINGS FAMILY',
        client: 'HOLLINGS FAMILY',
      }),
    ];

    expect(
      resolveMatterForOneDriveFolder(matters, folder('Hollings Family'))
    ).toEqual({ matterId: '', action: 'unassigned', name: 'Hollings Family' });
  });

  it('reuses a matter already linked to this folder key', () => {
    const linkedKey = buildOneDriveFolderKey(folder('Patel, Priya'));
    const matters: Matter[] = [
      makeMatter({
        id: 'matter-patel',
        name: 'Patel, Priya',
        client: 'Patel, Priya',
        onedriveFolderKeys: [linkedKey],
      }),
    ];

    expect(
      resolveMatterForOneDriveFolder(matters, folder('Patel, Priya'))
    ).toEqual({
      matterId: 'matter-patel',
      action: 'reuse',
      name: 'Patel, Priya',
    });
  });

  it('does not relink a name-match matter that already has a OneDrive folder key', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'matter-patel',
        name: 'Patel, Priya',
        client: 'Patel, Priya',
        onedriveFolderKeys: ['m365/default/other-drive:/clients/patel, priya'],
      }),
    ];

    expect(
      resolveMatterForOneDriveFolder(matters, folder('Patel, Priya'))
    ).toEqual({ matterId: '', action: 'unassigned', name: 'Patel, Priya' });
  });

  it('uses claimedMatterIds to prevent two folders claiming the same matter in one batch', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'matter-webb',
        name: 'Webb, Marcus & Tanya',
        client: 'Webb, Marcus & Tanya',
      }),
    ];

    const first = resolveMatterForOneDriveFolder(
      matters,
      folder('Webb, Marcus & Tanya')
    );
    expect(first.action).toBe('link');

    const claimed = new Set([first.matterId]);
    const second = resolveMatterForOneDriveFolder(
      matters,
      folder('Webb, Marcus & Tanya', '/Clients Duplicate/Webb, Marcus & Tanya'),
      claimed
    );

    expect(second).toEqual({
      matterId: '',
      action: 'unassigned',
      name: 'Webb, Marcus & Tanya',
    });
  });

  it('auto-links the Northcrest demo client folder set to matching matters', () => {
    const matters: Matter[] = NORTHCREST_CLIENT_NAMES.map((name) =>
      makeMatter({
        id: `matter-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        client: name,
      })
    );
    const claimedMatterIds = new Set<string>();

    const linked = NORTHCREST_CLIENT_NAMES.map((name) => {
      const resolution = resolveMatterForOneDriveFolder(
        matters,
        folder(name),
        claimedMatterIds
      );
      if (resolution.action === 'link')
        claimedMatterIds.add(resolution.matterId);
      return resolution;
    });

    expect(linked).toHaveLength(26);
    expect(linked.every((r) => r.action === 'link')).toBe(true);
    expect(new Set(linked.map((r) => r.matterId)).size).toBe(26);
  });
});
