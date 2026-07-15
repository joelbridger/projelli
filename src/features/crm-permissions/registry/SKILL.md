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

**Identity is bound to the native firm session, never the renderer.** The
current member is the firm `user_id` the native SSO exchange
(`firm_sso_authenticate`) received directly from the relay over TLS and holds in
process memory the renderer cannot reach (`commands/firm/session`). There is no
command that sets it — the old `crm_permissions_set_current_member` renderer
setter is removed — so a modified renderer cannot assume another member's
identity, and a forged `current-member` record written into the store has no
effect. `member_id` IS the firm `user_id` (org-scoped). Signing out
(`firm_session_end`) deny-closes.

The native `crm_permissions_*` commands are authoritative and derive the member
only from that session. With enforcement active they deny requests when no
member is bound or a record is outside that member's scope. The native
`crm_live_list`, `crm_live_upsert`, `crm_live_upsert_many`, and `crm_search`
commands delegate to this same check, so the active CRM screen cannot bypass it.
Search is scoped natively to the
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

**Enforcement is matter-granular, and multi-owner matters deny-close.** A matter
is the confidentiality boundary; a member entitled to a matter can read every
record in it. A matter is in a member's scope only when the member is entitled to
*every* household in it (`matter_read_scope`). So if an import ever collapsed two
differently-owned households onto one `matterId`, that matter is ambiguous and
drops out of both members' scope entirely rather than leaking the co-located
household — a shared-matter conflict fails safe, not open.

**Teams & Roles administration requires firm:manage.** While enforcement is
active, every role/team/assignment mutation is gated natively behind firm:manage
authority derived from the same session — an org admin (relay session) or a role
carrying `firm:manage`. An ordinary member cannot self-assign a privileged role
(e.g. compliance) to widen their own access.

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

This protects against UI bugs and forgeable per-call frontend identity claims,
including a modified renderer trying to declare an identity. It does not protect
against the machine's local user tampering with the process itself.

## Doorway audit and interlock

Every native command that can return or mutate client PII carries the same
authority (`matter_read_scope` / `protected_records` / `permitted_search_scopes`
/ `authorize_record_save` in `crm::features::permissions`), and each is listed in
the `CLIENT_DATA_DOORWAYS` registry: `crm_live_list`, `crm_live_upsert`,
`crm_live_upsert_many`, `crm_search`, `crm_permissions_list` /
`crm_permissions_get_record` / `crm_permissions_upsert`, `crm_trash_list`,
`crm_trash_restore`, `crm_migration_export`, `crm_list_households`, and
`rag_retrieve` (all-matter retrieval requires firm-wide authority). A
machine-checkable test asserts every entry is a registered command whose function
invokes a native authority symbol.

**Interlock (code-enforced):** `own_clients_permissions_enabled()` is the single
native source of truth and returns true only when the flag is on AND every
doorway in the registry is guarded. A future flag flip therefore cannot silently
reintroduce a leak: add an unguarded doorway and the feature reports OFF (honest,
never partially enforced). The renderer reads this resolved state via
`crm_permissions_enforcement_active` — the UI can never show "protected" while
native has it off.

## Enablement prerequisites (fail-closed, not leaks)

Two things must be true before this flag is enabled; until then it ships dark.

1. **Ownership stamping.** The check keys on `ownerMemberId` /
   `assignedMemberIds` on the `household` record. The create-household flow
   (`ClientsSurface`) and the importer write neither today (only display fields
   like `primaryAdvisor` / `ownership`), so with the flag on a member deny-closes
   on their own clients. Create/import must stamp `ownerMemberId` = the current
   member (edits/re-imports preserving it) first. Safe (a denial, never a leak).
2. **SSO sign-in.** Native identity is bound only through the Rust SSO exchange.
   A firm whose members sign in by password (that path does not pass through
   Rust) has no native identity, so enforcement deny-closes for them until a
   firm-auth-into-Rust seam covers password login. Safe, but SSO is required to
   use the feature. (Independent Ed25519 seat-token verification in Rust is a
   tracked defense-in-depth follow-up, not required for this binding.)
