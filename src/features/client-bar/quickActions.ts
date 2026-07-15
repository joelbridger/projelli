import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

export type ClientBarQuickAction = Pick<
  AppSurfaceDescriptor,
  'clientContext' | 'id' | 'labelKey' | 'order' | 'placement'
>;

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
