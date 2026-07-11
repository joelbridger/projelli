import { useEffect, useRef, useState } from 'react';

import {
  DOCUSIGN_RETURN_EVENT_PARAM,
  appOrigin,
  isDocusignCeremonyOutcome,
} from './origins';
import { createDocusignSigningMessage } from './message';

type ReturnPageState = 'sent' | 'invalid';

/**
 * Static, data-free handoff route. DocuSign appends only `event`; this component
 * refuses every other query parameter and forwards only a small outcome enum.
 */
export function SigningReturnPage(): JSX.Element {
  const [state, setState] = useState<ReturnPageState>('invalid');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get(DOCUSIGN_RETURN_EVENT_PARAM);
    if (params.size !== 1 || !isDocusignCeremonyOutcome(outcome)) return;
    if (!window.opener || window.opener.closed) return;

    try {
      window.opener.postMessage(createDocusignSigningMessage(outcome), appOrigin());
      setState('sent');
      window.setTimeout(() => window.close(), 150);
    } catch {
      setState('invalid');
    }
  }, []);

  return (
    <main className="page-shell">
      <section className="panel signing-panel" aria-live="polite">
        <p className="eyebrow">Signature step</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {state === 'sent' ? 'Your signing step is complete' : 'Something went wrong with signing'}
        </h1>
        <p>
          {state === 'sent'
            ? 'We are confirming your signed form now. You can return to the original tab.'
            : 'Please return to the original tab and ask your advisor for help.'}
        </p>
      </section>
    </main>
  );
}
