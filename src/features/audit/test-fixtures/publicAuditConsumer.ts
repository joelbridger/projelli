import {
  emitAuditEntry,
  getAuditActionDescriptor,
  type AuditWriteEntry,
} from '@/features/audit';

declare module '@/platform/types/audit' {
  interface AuditActionMap {
    user_action: true;
  }
}

const registeredDescriptor = getAuditActionDescriptor('user_action');
if (!registeredDescriptor) {
  throw new Error('Expected the public consumer audit action to be registered');
}
export const publicAuditConsumerDescriptor = registeredDescriptor;

export const publicAuditConsumerEntry: AuditWriteEntry = {
  action: publicAuditConsumerDescriptor.id,
  description: 'Public audit consumer completed its work',
  model: undefined,
  inputs: { source: 'fixture' },
  outputs: { completed: true },
  userDecision: 'auto',
  metadata: {
    auditEventType: 'audit-write-fixture.completed',
    registeredAction: publicAuditConsumerDescriptor.id,
  },
};

export function runPublicAuditConsumer() {
  return emitAuditEntry(publicAuditConsumerEntry);
}
