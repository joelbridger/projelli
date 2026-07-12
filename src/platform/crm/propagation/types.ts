/**
 * Propagation consumes the canonical CRM contracts. This compatibility module
 * keeps existing imports stable while deliberately defining no shapes itself.
 */
export { UNTOUCHED } from '@/platform/crm/types';
export type {
  AssignmentOperation,
  DerivedBeforeImage,
  DerivedField,
  DerivedFieldName,
  HlcStamp,
  OfferDecision,
  PropagationApplyEvent,
  PropagationDecision,
  PropagationEngineOffer as PropagationOffer,
  PropagationTransactionPayload,
  PropagationTransactionPort,
  RevisionSet,
  TemplateRevision,
  TemplateStepChange,
  WorkflowInstanceSnapshot,
  WorkflowStepProgress,
  WorkflowStepStatus,
  WorkflowTemplateSnapshot,
} from '@/platform/crm/types';
