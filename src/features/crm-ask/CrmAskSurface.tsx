/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued separately. */
import { useState } from 'react';
import { Ask } from '@/features/ask';
import type { AskTurn } from '@/features/ask/askHelpers';
import { CrmAskProposalPanel } from './CrmAskProposalPanel';

/** The CRM route reuses the product's primary Ask surface and its safety rails. */
export function CrmAskSurface() {
  const [latestAnswer, setLatestAnswer] = useState<AskTurn | null>(null);
  return <div data-testid="crm-ask-surface" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ minHeight: 0, flex: 1 }}>
      <Ask forceFilesOnly onAnswerCompleted={setLatestAnswer} />
    </div>
    <CrmAskProposalPanel answer={latestAnswer} />
  </div>;
}
