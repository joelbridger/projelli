import type { ReactNode } from 'react';
import type { HomeSurfaceRuntime } from './types';

export interface HomeWidgetHostRenderProps {
  runtime: HomeSurfaceRuntime;
}

export interface HomeWidgetHostDescriptor {
  id: string;
  order: number;
  render: (props: HomeWidgetHostRenderProps) => ReactNode;
}
