import type { ReactNode } from 'react';
import type { HouseholdRecord, CrmClientsActions, CrmPerson } from './adapters';
import type { HouseholdTab } from './tabRegistry';

/** Feature modules augment these maps beside their descriptors; typos stay type errors. */
export interface HouseholdHeaderActionIdMap {}
export interface HouseholdAddActionIdMap {}
export interface HouseholdSectionIdMap {}
export interface HouseholdRecordExtensionKeyMap {}

export type HouseholdHeaderActionId = Extract<
  keyof HouseholdHeaderActionIdMap,
  string
>;
export type HouseholdAddActionId = Extract<
  keyof HouseholdAddActionIdMap,
  string
>;
export type HouseholdSectionId = Extract<keyof HouseholdSectionIdMap, string>;
export type HouseholdRecordExtensionKey = Extract<
  keyof HouseholdRecordExtensionKeyMap,
  string
>;

export interface HouseholdRecordExtensionDescriptor<T = unknown> {
  id: string;
  dataKey: HouseholdRecordExtensionKey;
  defaultValue: T;
  validate(value: unknown): value is T;
  renderEditor?: (context: HouseholdRecordExtensionContext<T>) => ReactNode;
  renderSummary?: (context: HouseholdRecordExtensionContext<T>) => ReactNode;
}

export interface HouseholdRecordExtensionContext<T> {
  household: HouseholdRecord;
  value: T;
  save(value: T): Promise<void> | void;
}

export interface HouseholdRecordShellContext {
  household: HouseholdRecord;
  actions?: CrmClientsActions;
  onSaveHousehold?: (household: HouseholdRecord) => Promise<void> | void;
  openPanel: (panel: HouseholdRecordPanel) => void;
  setNoteAudience: (audience: 'internal' | 'client-facing') => void;
  setAdding: (kind: 'person' | 'account' | 'fact') => void;
  setEditingPerson: (person: CrmPerson) => void;
  deleteFact: (id: string) => Promise<void> | void;
  renderLegacyClientMap: () => ReactNode;
}

export type HouseholdRecordPanel = 'metadata' | 'household';

export interface HouseholdHeaderActionDescriptor {
  id: HouseholdHeaderActionId;
  order: number;
  mount: (context: HouseholdRecordShellContext) => ReactNode;
}

export interface HouseholdAddActionDescriptor {
  id: HouseholdAddActionId;
  order: number;
  mount: (context: HouseholdRecordShellContext) => ReactNode;
}

export interface HouseholdSectionDescriptor {
  id: HouseholdSectionId;
  order: number;
  tab: HouseholdTab;
  mount: (context: HouseholdRecordShellContext) => ReactNode;
}

function validateDescriptors(
  name: string,
  descriptors: readonly { id: string; order: number }[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id))
      throw new Error(`[${name}] duplicate id: ${descriptor.id}`);
    ids.add(descriptor.id);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${name}] order must be finite: ${descriptor.id}`);
  }
}

/** Validate a proposed header-action list before it is mounted in the record shell. */
export function validateHouseholdHeaderActionDescriptors(
  descriptors: readonly HouseholdHeaderActionDescriptor[]
): void {
  validateDescriptors('householdHeaderActionRegistry', descriptors);
}

/** Validate a proposed Add-menu action list before it is mounted in the record shell. */
export function validateHouseholdAddActionDescriptors(
  descriptors: readonly HouseholdAddActionDescriptor[]
): void {
  validateDescriptors('householdAddActionRegistry', descriptors);
}

/** Validate a proposed record-section list before it is mounted in the record shell. */
export function validateHouseholdSectionDescriptors(
  descriptors: readonly HouseholdSectionDescriptor[]
): void {
  validateDescriptors('householdSectionRegistry', descriptors);
}

export function validateHouseholdRecordExtensionDescriptors(
  descriptors: readonly HouseholdRecordExtensionDescriptor[]
): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id))
      throw new Error(
        `[householdRecordExtensionRegistry] duplicate extension id: ${descriptor.id}`
      );
    if (keys.has(descriptor.dataKey))
      throw new Error(
        `[householdRecordExtensionRegistry] duplicate data key: ${descriptor.dataKey}`
      );
    if (!descriptor.dataKey.includes('.'))
      throw new Error(
        `[householdRecordExtensionRegistry] data key must be namespaced: ${descriptor.id}`
      );
    if (!descriptor.validate(descriptor.defaultValue))
      throw new Error(
        `[householdRecordExtensionRegistry] default fails validator: ${descriptor.id}`
      );
    ids.add(descriptor.id);
    keys.add(descriptor.dataKey);
  }
}

// Compatibility descriptors preserve today's screen. Future feature folders append
// their own descriptors here without widening HouseholdRecord or editing the shell.
import {
  legacyHouseholdAddActions,
  legacyHouseholdHeaderActions,
  legacyHouseholdRecordExtensions,
  legacyHouseholdSections,
} from './recordRegistryCompatibility';
import {
  complianceDatesRecordExtension,
  writtenAgreementsSection,
} from './extensions/compliance-dates';
import { employmentHouseholdSection } from './extensions/employment';

export const householdHeaderActionRegistry: readonly HouseholdHeaderActionDescriptor[] =
  legacyHouseholdHeaderActions;
export const householdAddActionRegistry: readonly HouseholdAddActionDescriptor[] =
  legacyHouseholdAddActions;
export const householdSectionRegistry: readonly HouseholdSectionDescriptor[] =
  [...legacyHouseholdSections, employmentHouseholdSection, writtenAgreementsSection];
export const householdRecordExtensionRegistry: readonly HouseholdRecordExtensionDescriptor[] =
  [...legacyHouseholdRecordExtensions, complianceDatesRecordExtension];

export function getHouseholdHeaderActions() {
  validateHouseholdHeaderActionDescriptors(householdHeaderActionRegistry);
  return householdHeaderActionRegistry
    .slice()
    .sort((a, b) => a.order - b.order);
}
export function getHouseholdAddActions() {
  validateHouseholdAddActionDescriptors(householdAddActionRegistry);
  return householdAddActionRegistry.slice().sort((a, b) => a.order - b.order);
}
export function getHouseholdSections() {
  validateHouseholdSectionDescriptors(householdSectionRegistry);
  return householdSectionRegistry.slice().sort((a, b) => a.order - b.order);
}
export function getHouseholdRecordExtensions() {
  validateHouseholdRecordExtensionDescriptors(householdRecordExtensionRegistry);
  return householdRecordExtensionRegistry;
}
