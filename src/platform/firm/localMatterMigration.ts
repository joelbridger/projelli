/** Device-only migration of persisted firm linkage after the one-time v2 manifest. */
import type { Matter } from '@/platform/types/matter';
import { parseMatterHandle, parseStreamHandle, type MatterHandle, type StreamHandle } from './contract';

export interface LegacyFirmManifestLink {
  localMatterId: string;
  matterHandle: MatterHandle;
  rootStreamHandle: StreamHandle;
}

/**
 * Replace only the local routing linkage. Names, folders, and Matter.id are
 * copied unchanged. The caller obtains this mapping from the authenticated,
 * one-time migration manifest; no legacy ID is ever sent in this operation.
 */
export function migrateLocalMatterLinks(
  matters: Matter[],
  links: LegacyFirmManifestLink[],
): Matter[] {
  const byLocalId = new Map(links.map((link) => [link.localMatterId, {
    firmMatterId: parseMatterHandle(link.matterHandle),
    rootStreamHandle: parseStreamHandle(link.rootStreamHandle),
  }]));
  return matters.map((matter) => {
    const next = byLocalId.get(matter.id);
    return next ? { ...matter, ...next, shared: true } : matter;
  });
}
