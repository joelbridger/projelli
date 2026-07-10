import type { FormRequestKind, RequestItem } from './types';

/** A reusable, value-free recipe for a client request. */
export interface RequestBlueprint {
  blueprintId: string;
  schemaVersion: number;
  label: string;
  source: 'built_in' | 'firm_saved';
  defaultKind: FormRequestKind;
  items: RequestItem[];
  archived?: boolean;
}

export interface CreateFirmBlueprintInput {
  blueprintId: string;
  schemaVersion?: number;
  label: string;
  defaultKind?: FormRequestKind;
  items: RequestItem[];
}

export interface UpdateFirmBlueprintInput {
  label?: string;
  defaultKind?: FormRequestKind;
  items?: RequestItem[];
}
