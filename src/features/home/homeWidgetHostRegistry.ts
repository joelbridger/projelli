import type { HomeWidgetHostDescriptor } from './homeWidgetHostTypes';

/**
 * The base Home host starts empty. A future feature-owned personalization host
 * descriptor has one documented append point here; its widget registry remains
 * owned by that feature, not by Home.
 */
const homeWidgetHostRegistry: readonly HomeWidgetHostDescriptor[] = [];

/**
 * Validates and projects the supplied host descriptors without changing their
 * source order. Equal order values preserve their supplied order.
 */
export function getHomeWidgetHostDescriptors(
  descriptors: readonly HomeWidgetHostDescriptor[] = homeWidgetHostRegistry
): readonly HomeWidgetHostDescriptor[] {
  const seenIds = new Set<string>();

  for (const descriptor of descriptors) {
    if (seenIds.has(descriptor.id)) {
      throw new Error(
        `Duplicate Home widget host descriptor id: ${descriptor.id}`
      );
    }
    seenIds.add(descriptor.id);
  }

  return descriptors
    .map((descriptor, index) => ({ descriptor, index }))
    .sort(
      (left, right) =>
        left.descriptor.order - right.descriptor.order ||
        left.index - right.index
    )
    .map(({ descriptor }) => descriptor);
}
