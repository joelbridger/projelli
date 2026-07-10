import { createElement, type ReactNode } from 'react';

import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { LinkSignalBadges } from './LinkSignalBadge';

export function renderLinkSignalBadges(row: OnboardingRow): ReactNode {
  return createElement(LinkSignalBadges, { signals: row.linkSignals });
}
