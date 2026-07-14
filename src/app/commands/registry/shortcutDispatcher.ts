import {
  getAppSurfaceDescriptors,
  getOrderedAppSurfaces,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import type {
  CommandDescriptor,
  CommandRuntime,
} from '@/app/commands/registry/types';

const MODIFIER_ORDER = ['mod', 'shift', 'alt'] as const;

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    if (['ctrl', 'control', 'cmd', 'command', 'meta', 'mod'].includes(part)) {
      modifiers.add('mod');
    } else if (part === 'shift' || part === 'alt') {
      modifiers.add(part);
    } else {
      key = part;
    }
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key]
    .filter(Boolean)
    .join('+');
}

function keyboardEventShortcut(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('mod');
  // A literal '?' already carries the layout's Shift requirement in e.key.
  if (event.shiftKey && key !== '?') modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');
  return [...modifiers, key].join('+');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

function surfaceShortcutDescriptor(
  surface: AppSurfaceDescriptor,
  shortcut: string,
  suffix: string
): CommandDescriptor {
  return {
    id: `surface.jump.${surface.id}.${suffix}`,
    labelKey: surface.labelKey,
    legacyLabel: surface.legacyLabel ?? surface.errorLabel,
    category: 'navigation',
    shortcut,
    palette: false,
    execute: (runtime) => runtime.setSidebarActiveTab?.(surface.id),
    enabled: (runtime) => typeof runtime.setSidebarActiveTab === 'function',
  };
}

/** Numeric jumps always follow the visible primary tool order. */
export function getSurfaceShortcutDescriptors(
  surfaces: readonly AppSurfaceDescriptor[] = getAppSurfaceDescriptors()
): readonly CommandDescriptor[] {
  const numeric = getOrderedAppSurfaces('primary', surfaces)
    .slice(0, 9)
    .map((surface, index) =>
      surfaceShortcutDescriptor(surface, `Ctrl+${String(index + 1)}`, 'numeric')
    );
  const explicit = surfaces.flatMap((surface) =>
    (surface.shortcuts ?? []).map((shortcut, index) =>
      surfaceShortcutDescriptor(surface, shortcut, `explicit-${String(index)}`)
    )
  );
  return [...numeric, ...explicit];
}

export function getShortcutCommandDescriptors(
  commands: readonly CommandDescriptor[],
  surfaces: readonly AppSurfaceDescriptor[] = getAppSurfaceDescriptors()
): readonly CommandDescriptor[] {
  const descriptors = [
    ...commands.filter((descriptor) => descriptor.shortcut),
    ...getSurfaceShortcutDescriptors(surfaces),
  ];
  const shortcuts = new Set<string>();
  for (const descriptor of descriptors) {
    const shortcut = normalizeShortcut(descriptor.shortcut ?? '');
    if (shortcuts.has(shortcut)) {
      throw new Error(`[shortcutDispatcher] duplicate shortcut: ${shortcut}`);
    }
    shortcuts.add(shortcut);
  }
  return descriptors;
}

/** Returns true only when a registered command consumed the key event. */
export async function dispatchKeyboardShortcut(
  event: KeyboardEvent,
  runtime: CommandRuntime,
  descriptors: readonly CommandDescriptor[]
): Promise<boolean> {
  const pressed = keyboardEventShortcut(event);
  const descriptor = descriptors.find(
    (candidate) => normalizeShortcut(candidate.shortcut ?? '') === pressed
  );
  if (!descriptor) return false;
  if (isEditableTarget(event.target) && !descriptor.allowInEditable)
    return false;
  if (descriptor.enabled && !descriptor.enabled(runtime)) return false;

  event.preventDefault();
  await descriptor.execute(runtime);
  return true;
}
