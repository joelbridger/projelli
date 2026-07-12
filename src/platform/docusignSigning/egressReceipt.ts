export interface DocusignEgressReceipt {
  destinationClass: 'docusign';
  host: string;
  operation: 'Send for DocuSign signature';
  dataCategories: Array<'completed_pdf' | 'signer_name' | 'signer_email'>;
  requestId: string;
  signatureItemId: string;
  userConfirmed: true;
  at: string;
  outcome: 'allowed' | 'blocked_local_only';
}

/** Kept inside the encrypted signature envelope, never in the request-board store. */
export function createDocusignEgressReceipt(input: Omit<DocusignEgressReceipt, 'destinationClass' | 'operation' | 'dataCategories' | 'at'> & { at?: string }): DocusignEgressReceipt {
  if (!/\.docusign\.net$/iu.test(input.host)) throw new Error('DocuSign egress must use a docusign.net host.');
  return {
    destinationClass: 'docusign',
    host: input.host,
    operation: 'Send for DocuSign signature',
    dataCategories: ['completed_pdf', 'signer_name', 'signer_email'],
    requestId: input.requestId,
    signatureItemId: input.signatureItemId,
    userConfirmed: true,
    at: input.at ?? new Date().toISOString(),
    outcome: input.outcome,
  };
}
