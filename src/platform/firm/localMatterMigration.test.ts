import { describe, expect, it } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import { migrateLocalMatterLinks } from './localMatterMigration';

describe('local opaque firm-link migration', () => {
  it('migrates only matching legacy links across multiple matters and is idempotent', () => {
    const original = {
      id: 'local-matter-77', name: 'Nimbus household', client: 'CLIENT_SECRET_NIMBUS', folderPaths: ['/clients/nimbus'], mailFolderPaths: [], createdAt: '2026-01-01T00:00:00Z', firmMatterId: 'matter-semantic-123', shared: true,
    };
    const unrelated = {
      id: 'local-matter-88', name: 'Orion household', client: 'ORION_SECRET', folderPaths: ['/clients/orion', '/clients/orion/taxes'], mailFolderPaths: ['outlook/orion'], createdAt: '2026-01-02T00:00:00Z', shared: false,
    };
    const withoutLegacyLink = {
      id: 'local-matter-99', name: 'Local only', client: 'LOCAL_ONLY', folderPaths: ['/clients/local'], mailFolderPaths: [], createdAt: '2026-01-03T00:00:00Z', shared: false,
    };
    const links = [{
      localMatterId: original.id, matterHandle: parseMatterHandle(`mh2_${'A'.repeat(43)}`), rootStreamHandle: parseStreamHandle(`sh2_${'B'.repeat(43)}`),
    }];
    const migrated = migrateLocalMatterLinks([original, unrelated, withoutLegacyLink], links);
    expect(migrated[0]).toMatchObject({ id: original.id, name: original.name, client: original.client, folderPaths: original.folderPaths });
    expect(migrated[0]?.firmMatterId).toMatch(/^mh2_/);
    expect(migrated[0]?.rootStreamHandle).toMatch(/^sh2_/);
    expect(migrated[1]).toEqual(unrelated);
    expect(migrated[2]).toEqual(withoutLegacyLink);

    const rerun = migrateLocalMatterLinks(migrated, links);
    expect(rerun).toEqual(migrated);
    for (const [index, matter] of [original, unrelated, withoutLegacyLink].entries()) {
      expect(rerun[index]).toMatchObject({ id: matter.id, name: matter.name, folderPaths: matter.folderPaths });
    }
  });
});
