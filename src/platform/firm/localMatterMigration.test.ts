import { describe, expect, it } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import { migrateLocalMatterLinks } from './localMatterMigration';

describe('local opaque firm-link migration', () => {
  it('preserves the local matter identity, name, and folders while replacing only routing linkage', () => {
    const original = {
      id: 'local-matter-77', name: 'Nimbus household', client: 'CLIENT_SECRET_NIMBUS', folderPaths: ['/clients/nimbus'], mailFolderPaths: [], createdAt: '2026-01-01T00:00:00Z', firmMatterId: 'matter-semantic-123', shared: true,
    };
    const migrated = migrateLocalMatterLinks([original], [{
      localMatterId: original.id, matterHandle: parseMatterHandle(`mh2_${'A'.repeat(43)}`), rootStreamHandle: parseStreamHandle(`sh2_${'B'.repeat(43)}`),
    }]);
    expect(migrated[0]).toMatchObject({ id: original.id, name: original.name, client: original.client, folderPaths: original.folderPaths });
    expect(migrated[0]?.firmMatterId).toMatch(/^mh2_/);
    expect(migrated[0]?.rootStreamHandle).toMatch(/^sh2_/);
  });
});
