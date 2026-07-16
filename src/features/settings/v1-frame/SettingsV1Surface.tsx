import { Suspense, lazy } from 'react';
import { useFlag } from '@/platform/flags';
import type { SettingsV1Runtime } from './runtime';

const SettingsV1FrameEnabled = lazy(() =>
  import('./SettingsV1FrameEnabled').then((module) => ({
    default: module.SettingsV1FrameEnabled,
  }))
);

export interface SettingsV1SurfaceProps {
  runtime: SettingsV1Runtime;
}

/**
 * The dark-launch boundary deliberately owns only the flag read. Keeping the
 * enabled frame behind a lazy import means flag-off never reaches settings
 * registry reads, profile/workspace selectors, or frame effects.
 */
export function SettingsV1Surface({ runtime }: SettingsV1SurfaceProps) {
  // The flag check is deliberately the first operation. While dark, this is
  // exactly the existing Settings surface; none of the v1 frame or its panel
  // registry/data hooks are loaded.
  if (!useFlag('settings-shell-v1')) return runtime.legacy.settings();

  return (
    <Suspense fallback={null}>
      <SettingsV1FrameEnabled runtime={runtime} />
    </Suspense>
  );
}
