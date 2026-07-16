import type { EntityRef } from '@/platform/crm/types';

/** The only durable kinds used for CRM contacts. */
export type ContactKind = 'household' | 'person' | 'organization' | 'trust';

export interface ContactRef {
  kind: ContactKind;
  id: string;
  matterId: string;
  /** Display cache only. Never use this to look up a record. */
  label?: string;
}

export interface ContactChannel {
  id: string;
  address: string;
  kind: string;
  primary: boolean;
}

export interface ContactLink {
  contactId: string;
  kind: ContactKind;
  role?: string;
  label?: string;
}

export interface ContactCore {
  id: string;
  kind: ContactKind;
  matterId: string;
  displayName: string;
  lifecycle: string;
  ownerMemberId?: string;
  primaryAdvisor?: string;
  tagIds: readonly string[];
  createdAt?: string;
  updatedAt?: string;
  contextRefs: readonly EntityRef[];
  extensionData?: Readonly<Record<string, unknown>>;
}

interface ContactRecordBase extends ContactCore {
  /** The unmodified encrypted document, retained for lossless updates. */
  readonly source: Readonly<Record<string, unknown>>;
  readonly channels: readonly ContactChannel[];
  readonly contactLinks: readonly ContactLink[];
}

export interface HouseholdContactRecord extends ContactRecordBase {
  kind: 'household';
  name: string;
}

export interface PersonContactRecord extends ContactRecordBase {
  kind: 'person';
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface OrganizationContactRecord extends ContactRecordBase {
  kind: 'organization';
  name: string;
}

export interface TrustContactRecord extends ContactRecordBase {
  kind: 'trust';
  name: string;
}

export type ContactRecord =
  | HouseholdContactRecord
  | PersonContactRecord
  | OrganizationContactRecord
  | TrustContactRecord;

export type ContactCreateInput =
  | { kind: 'household'; matterId: string; name: string; lifecycle?: string; tagIds?: readonly string[]; extensionData?: Readonly<Record<string, unknown>> }
  | { kind: 'person'; matterId: string; firstName?: string; lastName?: string; name?: string; lifecycle?: string; tagIds?: readonly string[]; extensionData?: Readonly<Record<string, unknown>> }
  | { kind: 'organization' | 'trust'; matterId: string; name: string; lifecycle?: string; tagIds?: readonly string[]; extensionData?: Readonly<Record<string, unknown>> };

/** Patches deliberately exclude kind, base timestamps, and authority owner IDs. */
export type ContactPatch = Readonly<{
  name?: string;
  firstName?: string;
  lastName?: string;
  lifecycle?: string;
  primaryAdvisor?: string;
  tagIds?: readonly string[];
  contextRefs?: readonly EntityRef[];
  channels?: readonly ContactChannel[];
  extensionData?: Readonly<Record<string, unknown>>;
}>;

export interface ContactDirectoryProjection extends ContactCore {
  ref: ContactRef;
  status: string;
  ownerDisplay?: string;
  lastActivityAt?: string;
}

export interface RecordScreenProjection {
  ref: ContactRef;
  contact: ContactRecord;
  title: string;
}

export interface ContactPrintProjection {
  ref: ContactRef;
  title: string;
  lifecycle: string;
  ownerDisplay?: string;
  channels: readonly ContactChannel[];
}

export interface RelatedContactProjection {
  ref: ContactRef;
  role?: string;
  label: string;
}

export interface RelatedContactSummaryProjection extends RelatedContactProjection {
  kind: ContactKind;
}

export interface LegacyEmbeddedContactProjection {
  id: string;
  kind: Exclude<ContactKind, 'household'>;
  name: string;
  personType: 'person' | 'organization' | 'trust';
  roles: readonly string[];
  householdRole?: string;
  external?: boolean;
  relatedHouseholds: number;
  channel?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  companyName?: string;
  jobTitle?: string;
  addresses?: readonly unknown[];
  emails?: readonly unknown[];
  phones?: readonly unknown[];
  contextRefs?: readonly { kind: string; id: string; label?: string }[];
}

export interface ContactTypeDefinition {
  id: string;
  label: string;
  appliesTo: readonly ContactKind[];
}

export interface ContactTypeProjection extends ContactTypeDefinition {}
