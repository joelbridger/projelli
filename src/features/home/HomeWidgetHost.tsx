import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { getHomeWidgetHostDescriptors } from './homeWidgetHostRegistry';
import type { HomeWidgetHostDescriptor } from './homeWidgetHostTypes';
import type { HomeSurfaceRuntime } from './types';

export function HomeWidgetHost({
  runtime,
  descriptors,
}: {
  runtime: HomeSurfaceRuntime;
  descriptors?: readonly HomeWidgetHostDescriptor[];
}): ReactNode {
  const resolvedDescriptors = getHomeWidgetHostDescriptors(descriptors);

  if (resolvedDescriptors.length === 0) return null;

  return resolvedDescriptors.map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.render({ runtime })}</Fragment>
  ));
}
