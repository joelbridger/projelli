import type { EgressApproval, EgressOperation } from './types';

export function createApproval(operation: EgressOperation): EgressApproval {
  return {
    operationId: operation.id,
    title: operation.title,
    message: operation.approvalText,
    dataSummary: operation.dataSummary,
    recipient: operation.recipient,
    requiresFinalApproval: operation.requiresFinalApproval,
  };
}
