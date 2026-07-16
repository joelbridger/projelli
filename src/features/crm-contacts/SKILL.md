# CRM contacts paved path

Import contact data only from `@/features/crm-contacts`. The four durable
kinds are `household`, `person`, `organization`, and `trust`.

- Read reactively with `useContactRecordStore()`.
- Create or edit only with its async `create` and `update` methods. Do not
  import `useLiveCrmRecords`, `saveLiveCrmRecord`, or a raw CRM command.
- Validate drafts and references with the public validators. Contact IDs,
  channel IDs, tag IDs, and relationship IDs are stable and duplicate-free.
  Channel `primary` values must be real booleans, and `contextRefs` must use a
  known public `EntityKind`; truthy strings and lookalike kinds fail closed.
- Check a custom type with `contactTypeAppliesTo(definition, kind)`; a type
  never changes the record's durable kind.
- Resolve/open a record with `resolve(ref)` and make references with
  `toRecordRef(contact)`. Labels are never identity.
- Project a directory once with `projectDirectoryContacts`; do not build a
  second client-side contact data source.
- Only households own `contactLinks`. Use `linkContact`, `unlinkContact`, and
  `listRelated`; never write a paired reverse household list.
- The old embedded household people adapter is read-only:
  `adaptLegacyHouseholdRecord(household)`.
- Cross-feature links keep the complete `ContactRef`: task `contextRefs`,
  timeline activity `targetRef`, Documents `ContactFileLink`, mail
  `OpenMailSurfaceRequest.contactRef`, and `ContactPrintProjection.ref`.

Every consumer needs a small outside-package import fixture that imports only
its public owner index plus `@/features/crm-contacts`. Unknown namespaced
`extensionData` and canonical base fields are preserved on updates. Every
contact mutation returns the record found in the fresh canonical reload, not
the earlier upsert response.
