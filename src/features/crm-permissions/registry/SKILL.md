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
scope. The existing native `crm_live_list`, `crm_live_upsert`,
`crm_live_upsert_many`, and `crm_search` commands delegate to this same check,
so the active CRM screen cannot bypass it. Search is scoped natively to the
matters the member owns or is assigned; a non-owned client's rows are refused,
not hidden by the renderer, and a forged `matter_id` from the renderer returns
nothing. A firm-wide reader still searches every matter.

Search scope is derived from the member's household ownership mapped to each
household's `matterId` — never from a record asserting `id == matterId`, because
imported clients (Wealthbox, Salesforce, Redtail) give a household an `id`
distinct from its `matterId`. On its own that would be forgeable: `matterId` is
a renderer-supplied field, so a member could "own" a record that names another
member's matter and pull it into search range. The write doorway closes that —
`authorize_record_save` refuses a scoped member any record whose `matterId`
belongs to a matter that already holds live records but no household the member
owns or is assigned. A member may still onboard a brand-new client (a matter with
no live records yet) or write inside a matter they already share. Scanning the
whole matter — not only its household — also refuses claiming an *orphan* matter:
soft-delete has no cascade, so a household can be deleted while its notes and
facts survive, and those child records carry no per-record owner; treating the
matter as unclaimed would let a member adopt it and read the surviving PII.
Reserved firm buckets (`firm`, `firm_home`) are never client matters and never
enter a scoped member's set.

**Enforcement is matter-granular.** A matter is the confidentiality boundary; a
member entitled to a matter (through any household they own in it) can search
every record in it. This is correct while each `matterId` maps to a single
client owned by one member or explicitly co-assigned. An import that collapsed
two different clients onto one `matterId` under different owners would let either
owner see the other — that is a data-modeling error upstream, not something this
layer can distinguish, since it enforces at the matter the store itself keys on.

**Enablement prerequisite (fail-closed, not a leak).** The whole check keys on
`ownerMemberId` / `assignedMemberIds` on the `household` record. Today the
create-household flow (`ClientsSurface`) and the migration importer write neither
— they set display fields like `primaryAdvisor` and `ownership`, which never
grant access. So with the flag ON against current data a member cannot create,
edit, or search their own clients: every path deny-closes. That is safe (a
denial, never a leak), but it means **before this flag can be enabled the
create-household and import paths must stamp `ownerMemberId` = the current member
(and edits/re-imports must preserve it).** Until then the enforcement is correct
but the surface is unusable with the flag on — which is why it ships dark.

**Firm-relay sharing is a related boundary.** When a matter is promoted to
shared, co-advisors are granted the E2EE matter key. If that flow does not also
record them in the household's `assignedMemberIds`, this native check will
deny-close them (no search, no write) rather than leak — safe, but the firm-relay
lane must set `assignedMemberIds` (or teach this check to consult matter-key
holders) for legitimate collaborators.

This protects against UI bugs and forgeable per-call frontend identity claims.
It does not protect against the machine's local user modifying their own local
data; that boundary arrives with future firm-relay authentication.

## Doorway audit

Enforcement lives at every command that reads local client records from the
encrypted core store. The centralized authority is `protected_records` /
`permitted_search_scopes` in `crm::features::permissions`. Guarded today:
`crm_live_list`, `crm_live_upsert`, `crm_live_upsert_many`, and `crm_search`.

Two further local-store doorways return full client records and are owned by
other delivery lanes, each behind its own dark flag: `crm_trash_list` /
`crm_trash_restore` (`crm-trash-recovery`) and `crm_migration_export`. Before
either is enabled alongside `own-clients-permissions`, that lane must route its
read through the same `protected_records` / `permitted_search_scopes` authority.
`crm_list_households` is a remote connector fetch from the external CRM during
import, not a local-store read, so it is outside this scope.
