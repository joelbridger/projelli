import { legacyAppCommandDescriptors } from '@/app/commands/registry/legacyAppCommandDescriptors';
import { enCatalog as en } from '@/i18nCatalogs';
import type {
  CommandDescriptor,
  CommandRegistration,
} from '@/app/commands/registry/types';
import { normalizeShortcut } from '@/app/commands/registry/shortcutDispatcher';

/**
 * The only shared mount list for app commands. Existing entries are append-only
 * and never reordered during a feature wave.
 *
 * Future module example (one line, no shared import):
 * () => import('@/features/calendar/commands').then((m) => m.calendarCommands),
 */
export const commandRegistry: readonly CommandRegistration[] = [
  ...legacyAppCommandDescriptors,
];

function isDescriptor(
  registration: CommandRegistration
): registration is CommandDescriptor {
  return typeof registration !== 'function';
}

function isDescriptorResult(
  result: CommandDescriptor | readonly CommandDescriptor[]
): result is CommandDescriptor {
  return !Array.isArray(result);
}

function resolveEnglishLabel(labelKey: string): unknown {
  return labelKey.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, en);
}

export function validateCommandDescriptors(
  descriptors: readonly CommandDescriptor[]
): void {
  const ids = new Set<string>();
  const shortcuts = new Set<string>();

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[commandRegistry] duplicate command id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);

    const namespace = descriptor.labelKey.split('.')[0];
    if (!namespace || namespace === descriptor.labelKey) {
      throw new Error(
        `[commandRegistry] labelKey must include a namespace: ${descriptor.id}`
      );
    }

    if (typeof resolveEnglishLabel(descriptor.labelKey) !== 'string') {
      throw new Error(
        `[commandRegistry] labelKey does not resolve in en catalog: ${descriptor.labelKey} (${descriptor.id})`
      );
    }

    if (descriptor.shortcut) {
      const normalized = normalizeShortcut(descriptor.shortcut);
      if (shortcuts.has(normalized)) {
        throw new Error(
          `[commandRegistry] duplicate shortcut: ${descriptor.shortcut}`
        );
      }
      shortcuts.add(normalized);
    }
  }
}

let resolvedDescriptors = commandRegistry.filter(isDescriptor);
validateCommandDescriptors(resolvedDescriptors);

let resolution: Promise<readonly CommandDescriptor[]> | null = null;
let registryResolved = commandRegistry.every(isDescriptor);

export function hasLazyCommandRegistrations(): boolean {
  return !registryResolved;
}

export function getCommandDescriptors(): readonly CommandDescriptor[] {
  return resolvedDescriptors;
}

export function resolveCommandRegistry(): Promise<
  readonly CommandDescriptor[]
> {
  if (!hasLazyCommandRegistrations())
    return Promise.resolve(resolvedDescriptors);

  resolution ??= Promise.all(
    commandRegistry.map(async (registration) => {
      const result = isDescriptor(registration)
        ? registration
        : await registration();
      return isDescriptorResult(result) ? [result] : result;
    })
  ).then((groups) => {
    const descriptors = groups.flat();
    validateCommandDescriptors(descriptors);
    resolvedDescriptors = descriptors;
    registryResolved = true;
    return resolvedDescriptors;
  });
  return resolution;
}
