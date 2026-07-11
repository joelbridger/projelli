import { createElement, type ReactNode } from 'react';

import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { retryFailedDocumentExtraction } from '@/platform/intake/useDocumentExtractionIngestion';
import { LinkSignalBadges } from './LinkSignalBadge';

export function renderLinkSignalBadges(row: OnboardingRow): ReactNode {
  return createElement(LinkSignalBadges, {
    signals: row.linkSignals,
    onRetryExtraction: (signal) => {
      if (!signal.flagId) return Promise.resolve();
      return retryFailedDocumentExtraction(signal.flagId);
    },
  });
}
