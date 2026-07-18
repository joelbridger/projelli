export type CrmProviderId = 'wealthbox';

export interface CanonicalHouseholdRef {
  readonly provider: CrmProviderId;
  readonly householdId: string;
}

export interface SharedClientIdentity extends CanonicalHouseholdRef {
  readonly displayName: string;
  readonly primaryPeople?: readonly string[];
}

export type MatterScopeSelection =
  | { readonly kind: 'matter'; readonly matterId: string }
  | { readonly kind: 'matter-only'; readonly matterId: string }
  | { readonly kind: 'all-matters' }
  | { readonly kind: 'blocked-unresolved' };

export type PersistedSelectionHint =
  | {
      readonly version: 1;
      readonly source: 'specific-matter';
      readonly matterId: string;
      readonly client?: SharedClientIdentity;
    }
  | {
      readonly version: 1;
      readonly source: 'shared-client';
      readonly client: SharedClientIdentity;
    }
  | {
      readonly version: 1;
      readonly source: 'explicit-all-matters';
      readonly client?: SharedClientIdentity;
    }
  | {
      readonly version: 1;
      readonly source: 'blocked/refused';
      readonly matterId?: string;
      readonly client?: SharedClientIdentity;
    };

/** Every external restart value enters as data, never as a trusted runtime arm. */
export type RehydratedSelectionInput =
  | { readonly kind: 'persisted-hint'; readonly value: unknown }
  | { readonly kind: 'legacy-follower'; readonly activeMatterId: unknown };

