import type { ReactNode } from 'react';
import type { ContactRef } from '@/features/crm-contacts';
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
export type HouseholdSectionId = string;
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

/**
 * The only public identity a household-section contributor may rely on.
 * The shell's editor controls remain private to crm-clients.
 */
export interface HouseholdSectionContext {
  householdRef: ContactRef;
  matterId: string;
}

export interface HouseholdRecordShellContext {
  household: HouseholdRecord;
  /** Present only when the live record supplied a verified matter linkage. */
  sectionContext?: HouseholdSectionContext;
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
  /** The only context available to a public section contributor. */
  mount: (context: HouseholdSectionContext) => ReactNode;
}

/** Private bridge for sections that predate the public doorway. */
export interface HouseholdRecordShellSectionDescriptor {
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

const legacySectionMounts = new WeakMap<
  HouseholdSectionDescriptor,
  HouseholdRecordShellSectionDescriptor
>();

function adaptLegacySection(
  descriptor: HouseholdRecordShellSectionDescriptor
): HouseholdSectionDescriptor {
  const publicDescriptor: HouseholdSectionDescriptor = {
    id: descriptor.id,
    order: descriptor.order,
    tab: descriptor.tab,
    // The real mount happens only inside the record shell, where its private
    // controls are available. Public contributors never receive that shell.
    mount: () => null,
  };
  legacySectionMounts.set(publicDescriptor, descriptor);
  return publicDescriptor;
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
import { investmentProfileSection } from './extensions/investment-profile';
import { professionalContactsSection } from './extensions/professional-contacts/registry';
import {
  customFieldsAdvisorRecordExtension,
  customFieldsAdvisorSection,
} from './extensions/custom-fields';
import { householdMergeHeaderAction } from '@/features/crm-clients/extensions/merge';
import { isEnabled } from '@/platform/flags';

export const householdHeaderActionRegistry: readonly HouseholdHeaderActionDescriptor[] =
  [...legacyHouseholdHeaderActions, householdMergeHeaderAction];
export const householdAddActionRegistry: readonly HouseholdAddActionDescriptor[] =
  legacyHouseholdAddActions;
const registeredHouseholdSections: HouseholdSectionDescriptor[] = [
  ...legacyHouseholdSections,
  professionalContactsSection,
  employmentHouseholdSection,
  investmentProfileSection,
  writtenAgreementsSection,
  customFieldsAdvisorSection,
].map(adaptLegacySection);
export const householdSectionRegistry: readonly HouseholdSectionDescriptor[] =
  registeredHouseholdSections;
export const householdRecordExtensionRegistry: readonly HouseholdRecordExtensionDescriptor[] =
  [
    ...legacyHouseholdRecordExtensions,
    complianceDatesRecordExtension,
    customFieldsAdvisorRecordExtension,
  ];

export function getHouseholdHeaderActions() {
  validateHouseholdHeaderActionDescriptors(householdHeaderActionRegistry);
  return householdHeaderActionRegistry
    // A dark action is absent from the registry consumer, not merely a child
    // that happens to render null. That keeps the mounted toolbar byte-for-byte
    // identical and leaves no wrapper slot behind.
    .filter((action) => action.id !== 'merge_duplicate' || isEnabled('crm-merge-clients'))
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

/** Add a public section to the live registry and return its cleanup function. */
export function registerHouseholdSection(
  descriptor: HouseholdSectionDescriptor
): () => void {
  validateHouseholdSectionDescriptors([...householdSectionRegistry, descriptor]);
  registeredHouseholdSections.push(descriptor);
  return () => {
    const index = registeredHouseholdSections.indexOf(descriptor);
    if (index >= 0) registeredHouseholdSections.splice(index, 1);
  };
}

/** The record shell is the sole place legacy/private section mounts may run. */
export function mountHouseholdSection(
  descriptor: HouseholdSectionDescriptor,
  shell: HouseholdRecordShellContext
): ReactNode {
  const legacy = legacySectionMounts.get(descriptor);
  return legacy
    ? legacy.mount(shell)
    : shell.sectionContext
      ? descriptor.mount(shell.sectionContext)
      : null;
}
export function getHouseholdRecordExtensions() {
  validateHouseholdRecordExtensionDescriptors(householdRecordExtensionRegistry);
  return householdRecordExtensionRegistry;
}
