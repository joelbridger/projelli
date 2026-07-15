/**
 * The small navigation shape the shell supplies to the presentation feature.
 * Keeping this structural means the feature does not depend on app-shell
 * registry internals; future lazy surface descriptors can be passed through
 * unchanged by the shell.
 */
export interface ClientBarQuickAction {
  id: string;
  labelKey: string;
  order: number;
  placement: 'primary' | 'utility' | 'hidden';
  clientContext: 'shared' | 'firm' | 'preserve-hidden';
}

/**
 * The prototype's CRM / Ask / Meetings trio is intentionally registry-driven:
 * it completes itself when the Meetings surface registers as a shared primary
 * surface in its later wave.
 */
export function getSharedClientQuickActions(
  descriptors: readonly ClientBarQuickAction[]
): readonly ClientBarQuickAction[] {
  return descriptors
    .filter(
      (descriptor) =>
        descriptor.placement === 'primary' &&
        descriptor.clientContext === 'shared'
    )
    .slice()
    .sort((left, right) => left.order - right.order);
}
