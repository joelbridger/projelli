import type { SharedClientIdentity } from '@/platform/client-context';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Matter } from '@/platform/types/matter';

export interface ClientPickerHousehold extends SharedClientIdentity {
  description?: string;
}

/**
 * Builds the picker from the local confidentiality boundary. A household is
 * selectable only when its saved CRM key resolves to one live Matter; missing,
 * archived-only, and ambiguous links stay out of the directory and therefore
 * continue to fail closed in the production selection authority.
 */
export function projectClientPickerHouseholds(
  matters: readonly Matter[],
  records: readonly LiveCrmRecord[]
): readonly ClientPickerHousehold[] {
  const liveMattersByHousehold = new Map<string, Matter[]>();

  for (const matter of matters) {
    if (matter.archived) continue;
    for (const householdId of new Set(
      (matter.crmHouseholdKeys ?? []).map((key) => key.trim()).filter(Boolean)
    )) {
      const linked = liveMattersByHousehold.get(householdId) ?? [];
      linked.push(matter);
      liveMattersByHousehold.set(householdId, linked);
    }
  }

  const localNames = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== 'household') continue;
    const name = record['name'];
    if (typeof name === 'string' && name.trim()) {
      localNames.set(record.id, name.trim());
    }
  }

  return [...liveMattersByHousehold.entries()].flatMap(
    ([householdId, linkedMatters]) => {
      if (linkedMatters.length !== 1) return [];
      const matter = linkedMatters[0];
      if (!matter) return [];
      return [
        {
          provider: 'wealthbox' as const,
          householdId,
          displayName:
            localNames.get(householdId) ??
            (matter.client.trim() || matter.name.trim() || householdId),
        },
      ];
    }
  );
}
