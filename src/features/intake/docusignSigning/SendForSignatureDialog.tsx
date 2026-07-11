import { useState } from 'react';

import { Button } from '@/ui/button';
import type { SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';

export interface SendForSignatureDialogProps {
  open: boolean;
  signerName: string;
  signerEmail: string;
  status?: SignatureStatus;
  canSend: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (signer: { name: string; email: string }) => Promise<void> | void;
}

/** The surrounding request screen supplies the actual local-only checked send action. */
export function SendForSignatureDialog({ open, signerName, signerEmail, status, canSend, onOpenChange, onConfirm }: SendForSignatureDialogProps) {
  const [name, setName] = useState(signerName);
  const [email, setEmail] = useState(signerEmail);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const send = async () => {
    setSending(true); setError(null);
    try { await onConfirm({ name, email }); onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start signing.'); }
    finally { setSending(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label="Send for signature" style={{ border: '1px solid var(--kp-divider)', borderRadius: 10, background: 'var(--kp-surface-card)', padding: 18, marginTop: 12 }}>
    <h3 style={{ margin: 0, color: 'var(--kp-navy)' }}>Send for signature</h3>
    <p style={{ color: 'var(--color-muted-foreground)', fontSize: 13 }}>This sends the completed form and the signer&apos;s name and email directly to DocuSign.</p>
    {status ? <p data-testid="signature-live-status" style={{ fontSize: 13 }}>Status: {signatureStatusLabel(status)}</p> : null}
    <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>Signer name<input value={name} onChange={(event) => { setName(event.target.value); }} /></label>
    <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>Signer email<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); }} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button><Button type="button" disabled={!canSend || sending || !name.trim() || !email.trim()} onClick={() => { void send(); }}>{sending ? 'Sending…' : 'Confirm and send'}</Button></div>
  </div>;
}

export function signatureStatusLabel(status: SignatureStatus | undefined): string {
  switch (status) {
    case 'ready_to_send': case 'not_ready': return 'Ready to send';
    case 'envelope_created': case 'signing_opened': return 'Awaiting signature';
    case 'completion_pending': return 'Confirming signed form';
    case 'signed': return 'Signed';
    case 'declined': return 'Declined';
    case 'voided': case 'needs_followup': return 'Needs follow-up';
    default: return 'Ready to send';
  }
}
