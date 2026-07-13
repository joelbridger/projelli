/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued separately. */
import { useState } from 'react';
import { Ask } from '@/features/ask';
import type { AskTurn } from '@/features/ask/askHelpers';
import type { UseAskProps } from '@/features/ask/useAsk';
import { CrmSearchSurface } from '@/features/crm-search/CrmSearchSurface';
import { CrmAskProposalPanel } from './CrmAskProposalPanel';

/** The CRM route reuses the product's primary Ask surface and its safety rails. */
export function CrmAskSurface(props: Omit<UseAskProps, 'onAnswerCompleted'> = {}) {
  const [latestAnswer, setLatestAnswer] = useState<AskTurn | null>(null);
  const [mode, setMode] = useState<'answer' | 'records'>('answer');
  return <div data-testid="crm-ask-surface" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="Ask options" style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
      <button type="button" data-testid="crm-ask-answer-tab" aria-pressed={mode === 'answer'} onClick={() => { setMode('answer'); }}>Ask with citations</button>
      <button type="button" data-testid="crm-record-search-tab" aria-pressed={mode === 'records'} onClick={() => { setMode('records'); }}>Search saved records</button>
    </nav>
    {mode === 'records' ? <CrmSearchSurface /> : <><div style={{ minHeight: 0, flex: 1 }}>
      <Ask {...props} onAnswerCompleted={setLatestAnswer} />
    </div>
    <CrmAskProposalPanel answer={latestAnswer} /></>}
  </div>;
}
