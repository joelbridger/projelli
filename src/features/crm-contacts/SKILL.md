# CRM contacts paved path

Import contact data only from `@/features/crm-contacts`. The four durable
kinds are `household`, `person`, `organization`, and `trust`.

- Read reactively with `useContactRecordStore()`.
- Create or edit only with its async `create` and `update` methods. Do not
  import `useLiveCrmRecords`, `saveLiveCrmRecord`, or a raw CRM command.
- Resolve/open a record with `resolve(ref)` and make references with
  `toRecordRef(contact)`. Labels are never identity.
- Project a directory once with `projectDirectoryContacts`; do not build a
  second client-side contact data source.
- Only households own `contactLinks`. Use `linkContact`, `unlinkContact`, and
  `listRelated`; never write a paired reverse household list.
- The old embedded household people adapter is read-only:
  `adaptLegacyHouseholdRecord(household)`.

Every consumer needs a small outside-package import fixture that imports only
public contacts and CRM-clients indexes. Unknown namespaced `extensionData`
and canonical base fields are preserved on updates.
