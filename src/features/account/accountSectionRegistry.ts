import { legacyAccountSections } from './legacyAccountSections';
import { getActiveIntegrationsAccountSections } from './active-integrations';
import type { AccountSectionDescriptor } from './accountRegistryTypes';

/** The append-only mount list for Account-window tabs. */
export const accountSectionRegistry: readonly AccountSectionDescriptor[] =
  legacyAccountSections;

export function validateAccountSectionDescriptors(
  descriptors: readonly AccountSectionDescriptor[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[accountSectionRegistry] duplicate section id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!descriptor.labelKey.includes('.')) {
      throw new Error(
        `[accountSectionRegistry] labelKey must include a namespace: ${descriptor.id}`
      );
    }
  }
}

export function getAccountSectionDescriptors(
  descriptors: readonly AccountSectionDescriptor[] = [
    ...accountSectionRegistry,
    ...getActiveIntegrationsAccountSections(),
  ]
): readonly AccountSectionDescriptor[] {
  validateAccountSectionDescriptors(descriptors);
  return descriptors.slice().sort((a, b) => a.order - b.order);
}
