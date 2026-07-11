import type { SigningLaunchUiStatus } from '../types';

const COPY: Record<Exclude<SigningLaunchUiStatus, 'checking' | 'unavailable' | 'ready'>, { heading: string; body: string }> = {
  waiting: {
    heading: 'Your signing window is open',
    body: 'Finish signing with DocuSign in the other tab. This page will update when you return.',
  },
  confirming: {
    heading: 'Your signed form is being confirmed',
    body: 'Your advisor is confirming and filing the signed form. This page cannot confirm that step yet.',
  },
  cancelled: {
    heading: 'Your signing was not finished',
    body: 'You can return to your advisor if you would like another signing link.',
  },
  declined: {
    heading: 'You chose not to sign the form',
    body: 'Please contact your advisor if you would like to discuss the form or need another option.',
  },
  expired: {
    heading: 'This signing link has expired',
    body: 'Ask your advisor to resend the signing link.',
  },
  error: {
    heading: 'Something went wrong with signing',
    body: 'Please ask your advisor for help with this signing step.',
  },
};

export function SigningWaitingScreen({ status }: { status: Exclude<SigningLaunchUiStatus, 'checking' | 'unavailable' | 'ready'> }): JSX.Element {
  const copy = COPY[status];
  return (
    <section className="panel signing-panel" aria-live="polite">
      <p className="eyebrow">Signature step</p>
      <h1 tabIndex={-1}>{copy.heading}</h1>
      <p>{copy.body}</p>
    </section>
  );
}
