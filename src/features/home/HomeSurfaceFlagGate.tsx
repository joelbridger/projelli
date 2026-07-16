import { useFlag } from '@/platform/flags';
import { HomeOrientationSurface } from './HomeOrientationSurface';
import type { HomeSurfaceFlagGateProps } from './types';

export type { HomeSurfaceFlagGateProps } from './types';

/**
 * The Home mount checks the flag before it renders any v1 child. That keeps
 * the existing Home surface fully intact, and keeps v1 data work dormant,
 * until the feature is deliberately enabled.
 */
export function HomeSurfaceFlagGate({
  runtime,
  renderLegacy,
}: HomeSurfaceFlagGateProps) {
  const enabled = useFlag('home-surface-v1');

  if (!enabled) return renderLegacy();

  return <HomeOrientationSurface runtime={runtime} />;
}
