/**
 * A request to open the existing compose flow from a household record.
 *
 * This is intentionally a UI handoff only: it carries display context into
 * EmailWorkspace and never selects or mutates the active client.
 */
export interface EmailComposeHandoff {
  kind: 'household_draft';
  household: {
    id: string;
    label: string;
  };
  source: 'crm_household';
}
