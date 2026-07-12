import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import {
  NEW_HOUSEHOLD_BLUEPRINT as NEW_HOUSEHOLD_REQUEST_BLUEPRINT,
  NEW_HOUSEHOLD_NEXT_STEPS as DEFAULT_NEW_HOUSEHOLD_NEXT_STEPS,
} from '@/platform/intake/defaultBlueprints';
import { copyRequestBlueprint } from '@/platform/intake/blueprintValidation';
import type { FormRequest, RequestItem } from '@/platform/intake/types';

/** Kept for callers of the existing New Client flow. */
export const NEW_HOUSEHOLD_BLUEPRINT = NEW_HOUSEHOLD_REQUEST_BLUEPRINT.blueprintId;
export const NEW_HOUSEHOLD_NEXT_STEP = DEFAULT_NEW_HOUSEHOLD_NEXT_STEPS[0]
  ?? 'Your advisor reviews each item and follows up only if something needs a second look.';
export const NEW_HOUSEHOLD_NEXT_STEPS = [...DEFAULT_NEW_HOUSEHOLD_NEXT_STEPS];

export function defaultNewHouseholdItems(): RequestItem[] {
  return copyRequestBlueprint(NEW_HOUSEHOLD_REQUEST_BLUEPRINT).items;
}

export function buildNewHouseholdRequest(args: {
  requestId: string;
  matterId: string;
  items?: RequestItem[];
}): FormRequest {
  return instantiateRequestBlueprint({
    blueprint: NEW_HOUSEHOLD_REQUEST_BLUEPRINT,
    requestId: args.requestId,
    matterId: args.matterId,
    kind: 'onboarding',
    items: args.items ?? defaultNewHouseholdItems(),
  });
}
