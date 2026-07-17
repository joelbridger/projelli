/* eslint-disable lantern-i18n/no-hardcoded-string -- Compatibility adapters preserve frozen CRM copy without changing locale ownership. */
import { CalendarDays } from 'lucide-react';
import { Button } from '@/ui/kp';
import type {
  HouseholdAddActionDescriptor,
  HouseholdHeaderActionDescriptor,
  HouseholdRecordExtensionDescriptor,
  HouseholdRecordShellContext,
  HouseholdRecordShellSectionDescriptor,
} from './recordRegistry';

declare module './tabRegistry' {
  interface HouseholdTabRouteMap {
    client_map: true;
    timeline: true;
    documents: true;
    email: true;
    meeting_notes: true;
    meetings: true;
    reviews: true;
    activity: true;
  }
}

declare module './recordRegistry' {
  interface HouseholdHeaderActionIdMap {
    ask: true;
    metadata: true;
    edit: true;
    schedule: true;
  }
  interface HouseholdAddActionIdMap {
    fact: true;
    note: true;
    task: true;
    account: true;
    person: true;
    opportunity: true;
    workflow: true;
    client_note: true;
  }
  interface HouseholdSectionIdMap {
    client_map: true;
  }
  interface HouseholdRecordExtensionKeyMap {
    'legacy.record-metadata': true;
  }
}

const householdRef = (household: { id: string; name: string }) => ({
  kind: 'household',
  id: household.id,
  label: household.name,
});

const deferredAddAction = (
  id: 'task' | 'opportunity' | 'workflow',
  order: number
): HouseholdAddActionDescriptor => ({
  id,
  order,
  mount: ({ household, actions }: HouseholdRecordShellContext) => (
    <Button
      variant="secondary"
      size="sm"
      data-testid={`crm-household-add-${id}`}
      onClick={() =>
        actions?.onAdd?.({
          kind: id,
          householdRef: householdRef(household),
          contextRefs: [householdRef(household)],
        })
      }
    >
      Add {id}
    </Button>
  ),
});

const scheduleAction = ({
  household,
  actions,
}: HouseholdRecordShellContext) => {
  const { schedulingLinkUrl } = household;
  return schedulingLinkUrl ? (
    <Button
      size="sm"
      variant="secondary"
      iconLeft={CalendarDays}
      data-testid="crm-household-schedule"
      onClick={() => {
        actions?.onOpenSchedulingLink?.(schedulingLinkUrl);
      }}
    >
      Schedule with this household
    </Button>
  ) : (
    <span
      title="Ask a firm admin to add a scheduling link"
      style={{ fontSize: 13, color: 'var(--color-slate-500)' }}
    >
      Scheduling link unavailable
    </span>
  );
};

export const legacyHouseholdHeaderActions: readonly HouseholdHeaderActionDescriptor[] =
  [
    {
      id: 'ask',
      order: 10,
      mount: ({ household, actions }) => (
        <Button
          size="sm"
          data-testid="crm-ask-household"
          onClick={() => actions?.onAskHousehold?.(household.id)}
        >
          Ask this household
        </Button>
      ),
    },
    {
      id: 'metadata',
      order: 20,
      mount: ({ openPanel }) => (
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-metadata"
          onClick={() => {
            openPanel('metadata');
          }}
        >
          Fields and tags
        </Button>
      ),
    },
    {
      id: 'edit',
      order: 30,
      mount: ({ openPanel }) => (
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-edit"
          onClick={() => {
            openPanel('household');
          }}
        >
          Edit household
        </Button>
      ),
    },
    { id: 'schedule', order: 40, mount: scheduleAction },
  ];

export const legacyHouseholdAddActions: readonly HouseholdAddActionDescriptor[] =
  [
    {
      id: 'fact',
      order: 10,
      mount: ({ setAdding }) => (
        <Button
          variant="secondary"
          size="sm"
          data-testid="crm-household-add-fact"
          onClick={() => {
            setAdding('fact');
          }}
        >
          Add fact
        </Button>
      ),
    },
    {
      id: 'note',
      order: 20,
      mount: ({ setNoteAudience }) => (
        <Button
          variant="secondary"
          size="sm"
          data-testid="crm-household-add-note"
          onClick={() => {
            setNoteAudience('internal');
          }}
        >
          Add internal note
        </Button>
      ),
    },
    deferredAddAction('task', 30),
    {
      id: 'account',
      order: 40,
      mount: ({ setAdding }) => (
        <Button
          variant="secondary"
          size="sm"
          data-testid="crm-household-add-account"
          onClick={() => {
            setAdding('account');
          }}
        >
          Add account
        </Button>
      ),
    },
    {
      id: 'person',
      order: 50,
      mount: ({ setAdding }) => (
        <Button
          variant="secondary"
          size="sm"
          data-testid="crm-household-add-person"
          onClick={() => {
            setAdding('person');
          }}
        >
          Add person
        </Button>
      ),
    },
    deferredAddAction('opportunity', 60),
    deferredAddAction('workflow', 70),
    {
      id: 'client_note',
      order: 80,
      mount: ({ setNoteAudience }) => (
        <Button
          size="sm"
          variant="secondary"
          data-testid="crm-household-add-client-note"
          onClick={() => {
            setNoteAudience('client-facing');
          }}
        >
          Add client-facing note
        </Button>
      ),
    },
  ];

export const legacyHouseholdSections: readonly HouseholdRecordShellSectionDescriptor[] = [
  {
    id: 'client_map',
    order: 10,
    tab: 'client_map',
    mount: ({ renderLegacyClientMap }) => <>{renderLegacyClientMap()}</>,
  },
];

/** Existing fields remain readable through this compatibility descriptor. New features use a namespaced extension value instead. */
export const legacyHouseholdRecordExtensions: readonly HouseholdRecordExtensionDescriptor[] =
  [
    {
      id: 'legacy-record-metadata',
      dataKey: 'legacy.record-metadata',
      defaultValue: null,
      validate: (value): value is null => value === null,
    },
  ];
