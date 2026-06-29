import type { Matter } from '@/platform/types/matter';
import type {
  WealthboxContactSummary,
  WealthboxSyncMapping,
} from '@/platform/utils/wealthbox-commands';

export interface WealthboxMatterPlan {
  mapping: WealthboxSyncMapping;
  matterName: string;
  created: boolean;
}

export type CreateMatterForWealthbox = (input: {
  name: string;
  client: string;
  folderPaths?: string[];
  mailFolderPaths?: string[];
}) => Matter;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findMatterForWealthboxContact(
  contact: WealthboxContactSummary,
  matters: Matter[],
): Matter | undefined {
  const target = normalizeName(contact.name);
  if (!target) return undefined;
  return matters.find((matter) => {
    if (matter.isSample || matter.archived) return false;
    return normalizeName(matter.client) === target || normalizeName(matter.name) === target;
  });
}

export function buildWealthboxMatterMappings(
  contacts: WealthboxContactSummary[],
  matters: Matter[],
  createMatter: CreateMatterForWealthbox,
): WealthboxMatterPlan[] {
  const knownMatters = [...matters];
  return contacts.map((contact) => {
    const existing = findMatterForWealthboxContact(contact, knownMatters);
    const matter = existing ?? createMatter({
      name: contact.name,
      client: contact.name,
      folderPaths: [],
      mailFolderPaths: [],
    });
    if (!existing) knownMatters.push(matter);
    return {
      mapping: {
        wealthboxContactId: contact.id,
        matterId: matter.id,
      },
      matterName: matter.name || matter.client || matter.id,
      created: !existing,
    };
  });
}
