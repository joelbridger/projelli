import { useCallback, useEffect, useRef, useState } from 'react';
import {
  setPromptDecisionBroker,
  type PromptDecision,
  type SecretFinding,
} from '@/platform/privacy/promptPreparation';
import { PromptPreparationDialog } from '@/platform/privacy/ui/PromptPreparationDialog';

interface PendingDecision {
  findings: SecretFinding[];
  resolve: (decision: PromptDecision) => void;
}

/** Connect an interactive Ask surface to the safe-copy or cancel dialog. */
export function usePromptPreparationDecision() {
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const pendingRef = useRef<PendingDecision | null>(null);

  useEffect(() => {
    setPromptDecisionBroker(({ findings }) => new Promise<PromptDecision>((resolve) => {
      const next = { findings, resolve };
      pendingRef.current = next;
      setPending(next);
    }));
    return () => {
      setPromptDecisionBroker();
      pendingRef.current?.resolve('cancel');
      pendingRef.current = null;
    };
  }, []);

  const decide = useCallback((decision: PromptDecision) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(decision);
  }, []);

  return (
    <PromptPreparationDialog
      open={pending !== null}
      findings={pending?.findings ?? []}
      onSendRedactedCopy={() => { decide('send_redacted_copy'); }}
      onCancel={() => { decide('cancel'); }}
    />
  );
}
