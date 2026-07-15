/**
 * Dated, client-specific evidence for the written agreements shown on the
 * record Details surface. A missing date is deliberately null, never guessed.
 */
export interface ComplianceDatesPayload {
  advisoryAgreementSignedOn: string | null;
  investmentPolicyStatementUpdatedOn: string | null;
  formAdvDeliveredOn: string | null;
  formCrsDeliveredOn: string | null;
  privacyNoticeDeliveredOn: string | null;
  financialPlanningAgreementRenewedOn: string | null;
}

export type ComplianceDateField = keyof ComplianceDatesPayload;

export const COMPLIANCE_DATE_FIELDS: readonly ComplianceDateField[] = [
  'advisoryAgreementSignedOn',
  'investmentPolicyStatementUpdatedOn',
  'formAdvDeliveredOn',
  'formCrsDeliveredOn',
  'privacyNoticeDeliveredOn',
  'financialPlanningAgreementRenewedOn',
];

export const EMPTY_COMPLIANCE_DATES: ComplianceDatesPayload = {
  advisoryAgreementSignedOn: null,
  investmentPolicyStatementUpdatedOn: null,
  formAdvDeliveredOn: null,
  formCrsDeliveredOn: null,
  privacyNoticeDeliveredOn: null,
  financialPlanningAgreementRenewedOn: null,
};
