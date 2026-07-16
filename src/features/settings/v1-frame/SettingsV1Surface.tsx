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
  if (!useFlag('settings-shell-v1')) return null;

  return (
    <Suspense fallback={null}>
      <SettingsV1FrameEnabled runtime={runtime} />
    </Suspense>
  );
}
