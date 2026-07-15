# Permission policy registry

This registry is the one append-only list of CRM permission policies. It lives
inside `crm-permissions` because policies are a permissions feature concern,
not a general shared-file switchboard.

## Descriptor shape

Every `PermissionPolicyDescriptor` has a stable kebab-case `id`, a short name
and description, and two pure front-end functions: `permitsRecord` and
`filterRecords`. The descriptor must declare `authority:
'native-command-layer'`. Front-end filtering is a display mirror only.

## Adding a policy

1. Add a new descriptor in `permissionPolicyRegistry.ts`.
2. Append it to `permissionPolicyRegistry`; do not reorder existing policies.
3. Add tests covering the policy and registry validation.
4. Add or extend the matching native feature command enforcement before a UI
   consumes it.

The validation test rejects duplicate ids, missing required text, an incorrect
authority declaration, and missing enforcement functions.

## Enforcement guarantee and threat model

`own-clients-only` permits records for the bound member only when a durable
`ownerMemberId` or `assignedMemberIds` says so. `primaryAdvisor` is display
copy and never grants access. `firm-read` allows firm-wide reads, while the
role's `clients:read` or `clients:write` capability remains required.

The native `crm_permissions_*` commands are authoritative and derive the
member only from native `current_member` storage. With the feature flag on,
they deny requests when no member is bound or a record is outside that member's
scope. This protects against UI bugs and forgeable per-call frontend identity
claims. It does not protect against the machine's local user modifying their
own local data; that boundary arrives with future firm-relay authentication.
