import type { ReactNode } from 'react';
import type { CrmPerson, HouseholdDirectoryEntry } from './adapters';

/** Feature modules augment these maps beside their directory descriptors. */
export interface DirectoryToolIdMap {}
export interface DirectoryActionIdMap {}
export interface DirectoryRailIdMap {}
export interface DirectoryViewIdMap {}

export type DirectoryToolId = Extract<keyof DirectoryToolIdMap, string>;
export type DirectoryActionId = Extract<keyof DirectoryActionIdMap, string>;
export type DirectoryRailId = Extract<keyof DirectoryRailIdMap, string>;
export type DirectoryViewId = Extract<keyof DirectoryViewIdMap, string>;

export interface DirectoryContext {
  query: { value: string; setValue(value: string): void };
  selection: {
    person: CrmPerson | null;
    setPerson(person: CrmPerson | null): void;
  };
  sort: { value: string | null; setValue(value: string | null): void };
  filters: {
    tab: string;
    setTab(value: string): void;
    externalOnly: boolean;
    setExternalOnly(value: boolean): void;
    needsVerification: boolean;
    setNeedsVerification(value: boolean): void;
  };
  records: {
    people: readonly CrmPerson[];
    households: readonly HouseholdDirectoryEntry[];
  };
  repository: {
    openHousehold(id: string): void;
    reviewRecipient(id: string): void;
    createHousehold(name: string): Promise<void> | void;
  };
}

interface DirectoryDescriptorBase<Id extends string> {
  id: Id;
  order: number;
  mount(context: DirectoryContext): ReactNode;
}

export interface DirectoryToolDescriptor extends DirectoryDescriptorBase<DirectoryToolId> {
  /**
   * Lets a descriptor opt out before the directory shell creates its layout
   * wrapper. Use this for flag-gated tools that otherwise render `null`.
   */
  isEnabled?(): boolean;
}
export interface DirectoryActionDescriptor extends DirectoryDescriptorBase<DirectoryActionId> {}
export interface DirectoryRailDescriptor extends DirectoryDescriptorBase<DirectoryRailId> {}
export interface DirectoryViewDescriptor extends DirectoryDescriptorBase<DirectoryViewId> {}

function validateDescriptors(
  name: string,
  descriptors: readonly DirectoryDescriptorBase<string>[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id))
      throw new Error(`[${name}] duplicate id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${name}] order must be finite: ${descriptor.id}`);
    if (typeof descriptor.mount !== 'function')
      throw new Error(`[${name}] mount must be a function: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}

export const validateDirectoryToolDescriptors = (
  descriptors: readonly DirectoryToolDescriptor[]
) => {
  validateDescriptors('directoryToolRegistry', descriptors);
};
export const validateDirectoryActionDescriptors = (
  descriptors: readonly DirectoryActionDescriptor[]
) => {
  validateDescriptors('directoryActionRegistry', descriptors);
};
export const validateDirectoryRailDescriptors = (
  descriptors: readonly DirectoryRailDescriptor[]
) => {
  validateDescriptors('directoryRailRegistry', descriptors);
};
export const validateDirectoryViewDescriptors = (
  descriptors: readonly DirectoryViewDescriptor[]
) => {
  validateDescriptors('directoryViewRegistry', descriptors);
};

import {
  legacyDirectoryActions,
  legacyDirectoryRails,
  legacyDirectoryTools,
  legacyDirectoryViews,
} from './directoryRegistryCompatibility';
import { bulkSelectDirectoryTool } from './extensions/bulk-select';

/** Append feature-owned directory tools here without changing the directory shell. */
export const directoryToolRegistry: readonly DirectoryToolDescriptor[] = [
  ...legacyDirectoryTools,
  bulkSelectDirectoryTool,
];
export const directoryActionRegistry: readonly DirectoryActionDescriptor[] =
  legacyDirectoryActions;
export const directoryRailRegistry: readonly DirectoryRailDescriptor[] =
  legacyDirectoryRails;
export const directoryViewRegistry: readonly DirectoryViewDescriptor[] =
  legacyDirectoryViews;

function sorted<T extends DirectoryDescriptorBase<string>>(
  descriptors: readonly T[],
  validate: (items: readonly T[]) => void
): readonly T[] {
  validate(descriptors);
  return descriptors.slice().sort((a, b) => a.order - b.order);
}

export const getDirectoryTools = () =>
  sorted(directoryToolRegistry, validateDirectoryToolDescriptors);
export const getDirectoryActions = () =>
  sorted(directoryActionRegistry, validateDirectoryActionDescriptors);
export const getDirectoryRails = () =>
  sorted(directoryRailRegistry, validateDirectoryRailDescriptors);
export const getDirectoryViews = () =>
  sorted(directoryViewRegistry, validateDirectoryViewDescriptors);
