import type { FormRequest, FormRequestKind } from './types';
import { assertValidRequestBlueprint, copyRequestBlueprint } from './blueprintValidation';
import type { RequestBlueprint } from './blueprintTypes';

export interface InstantiateBlueprintOptions {
  blueprint: RequestBlueprint;
  requestId: string;
  matterId: string;
  kind?: FormRequestKind;
  items?: RequestBlueprint['items'];
}

/** Builds a sealed-request-ready copy without changing the source blueprint. */
export function instantiateRequestBlueprint({
  blueprint,
  requestId,
  matterId,
  kind,
  items,
}: InstantiateBlueprintOptions): FormRequest {
  const source = copyRequestBlueprint({
    ...blueprint,
    ...(items ? { items } : {}),
  });
  assertValidRequestBlueprint(source);
  if (!requestId.trim()) throw new Error('Request id is required.');
  if (!matterId.trim()) throw new Error('Matter id is required.');
  return {
    request_id: requestId,
    schema_version: source.schemaVersion,
    matter_id: matterId,
    kind: kind ?? source.defaultKind,
    blueprint_ref: source.blueprintId,
    items: source.items,
  };
}
