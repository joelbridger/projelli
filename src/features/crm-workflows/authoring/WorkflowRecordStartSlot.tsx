import { useState } from 'react';
import type { CrmHouseholdAddRequest } from '@/features/crm-home';
import type { StartWorkflowInput } from '../workflowTemplateStore';
import { WorkflowAuthoringRuleMount } from './WorkflowAuthoringMount';
import {
  defaultWorkflowRecordStartComposition,
  mountWorkflowRecordStarts,
  validateWorkflowRecordStartDescriptors,
  type WorkflowRecordStartComposition,
  type WorkflowRecordStartRequest,
} from './workflowAuthoringExtensionPoints';

function isWorkflowRecordStartRequest(
  request: CrmHouseholdAddRequest
): request is WorkflowRecordStartRequest {
  return request.kind === 'workflow';
}

export interface WorkflowRecordStartSlotProps {
  /** The unchanged one-shot request already carried by CRM Home. */
  addRequest?: CrmHouseholdAddRequest;
  /** The host's canonical household choices; matter identity is retained. */
  households: readonly Readonly<StartWorkflowInput>[];
  /** The already-landed router callback that clears the one-shot request. */
  onAddRequestConsumed?: () => void;
  /** Selects the current record when the existing authoring library opens. */
  templateId?: string;
  /** Open-world fixture/host composition; production uses the append-only registry. */
  composition?: WorkflowRecordStartComposition;
}

/**
 * Sanctioned host slot for record-bound workflow starts.
 *
 * The outer function checks descriptor gates before mounting the enabled child,
 * so an empty/dark registry creates no state, request read, household lookup,
 * authoring store, wrapper, or visual gap.
 */
export function WorkflowRecordStartSlot(
  props: WorkflowRecordStartSlotProps
) {
  const composition =
    props.composition ?? defaultWorkflowRecordStartComposition;
  validateWorkflowRecordStartDescriptors(composition.starts);
  const enabledStarts = composition.starts.filter(
    (descriptor) => descriptor.isEnabled?.() ?? true
  );
  if (enabledStarts.length === 0) return null;

  return (
    <EnabledWorkflowRecordStartSlot
      {...props}
      composition={{ starts: enabledStarts }}
    />
  );
}

function EnabledWorkflowRecordStartSlot({
  addRequest,
  households,
  onAddRequestConsumed,
  templateId,
  composition,
}: WorkflowRecordStartSlotProps & {
  composition: WorkflowRecordStartComposition;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const request: WorkflowRecordStartRequest | null =
    addRequest && isWorkflowRecordStartRequest(addRequest)
      ? addRequest
      : null;

  if (libraryOpen && request === null) {
    return <WorkflowAuthoringRuleMount templateId={templateId ?? ''} />;
  }
  if (!request || !onAddRequestConsumed) return null;

  const lifecycle = { consumed: false };
  const consume = () => {
    if (lifecycle.consumed) return;
    lifecycle.consumed = true;
    onAddRequestConsumed();
  };
  const openTemplateLibrary = () => {
    if (lifecycle.consumed) return;
    setLibraryOpen(true);
    consume();
  };
  const selectedHousehold = households.find(
    (household) => household.id === request.householdId
  );

  return (
    <>
      {mountWorkflowRecordStarts(
        {
          request,
          household: {
            id: request.householdId,
            label: request.householdLabel,
            ...(selectedHousehold?.matterId
              ? { matterId: selectedHousehold.matterId }
              : {}),
          },
          onRequestConsumed: consume,
          openTemplateLibrary,
        },
        composition
      )}
    </>
  );
}
