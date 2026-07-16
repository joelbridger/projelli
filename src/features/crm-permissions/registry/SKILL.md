# Permission policy registry

This registry is the one append-only list of CRM permission policies. It lives
inside `crm-permissions` because policies are a permissions feature concern,
not a general shared-file switchboard.

## What this doorway is — and what it is NOT (read this first)

This landing is the **read-side permission doorway only**: a pure front-end
policy registry plus display mirrors. It carries **no security guarantee**. The
provable native enforcement engine — the runtime per-command guards, the
`CLIENT_DATA_DOORWAYS` interlock, and native firm-session identity binding — is
**deferred and is not part of this build**. It ships separately, behind the
still-open provable-no-bypass decision.

Present in this landing (all pure TypeScript, no native code):

- `PermissionPolicyDescriptor`, the append-only `permissionPolicyRegistry`, and
  its validator `validatePermissionPolicyRegistry`.
- The one shipped policy, `own-clients-only` (`ownClientsOnlyPolicy`).
- The display mirrors `filterOwnClientRecords` (batch) and
  `permitsOwnClientRecord` (single record), plus the enforcement-state accessor
  `ownClientsEnforcementActive`.

**Deferred — NOT present here:** every native `crm_permissions_*` command, the
doorway interlock and its exhaustiveness audit, native SSO-bound identity, and
the no-bypass guarantee. Until that lands and is proven on, there is **no
enforcement** anywhere — only a front-end display mirror.

## The one rule for consumers (the thing not to get wrong)

`ownClientsEnforcementActive()` resolves **`false`** in this build (no native
engine ⇒ enforcement is definitionally inactive). Both mirrors are therefore a
**no-op**: they return **every** record unchanged. A dark mirror shows
**everything**.

So any feature that consumes this doorway to scope what a member sees **MUST
stay flag-off (dark) until the native enforcement engine lands and is proven
on.** A feature shipped **live** while relying on this dark doorway to isolate
clients would display **unscoped** client data — a leak. The doorway scopes
*display only*; the native layer is the authority, and it is deferred.

Consumers decide whether to filter by reading `ownClientsEnforcementActive()` —
**never the renderer feature flag.** A renderer flag deciding a security-visible
state is the FE-on / native-off desync (re-review Finding 6): the UI could claim
clients are isolated while the native layer has enforcement off. The accessor is
the single source of truth; the enforcement lane rewires its body to the native
interlock when the engine lands, so consumer call sites never change.

## Descriptor shape

Every `PermissionPolicyDescriptor` has a stable kebab-case `id`, a short name
and description, and two pure front-end functions: `permitsRecord` and
`filterRecords`. The descriptor must declare `authority:
'native-command-layer'` — a label naming *where the real (deferred) enforcement
will live*, not a claim that it is wired here. Front-end filtering is a display
mirror only; it never grants access.

`own-clients-only` permits a record only when a durable `ownerMemberId` or
`assignedMemberIds` includes the bound member (or the role carries `firm-read`
scope), and only when the role holds the matching `clients:read` /
`clients:write` capability. `primaryAdvisor` is display copy and never grants
access.

## Adding a policy

1. Add a new descriptor in `permissionPolicyRegistry.ts`.
2. Append it to `permissionPolicyRegistry`; do not reorder existing policies.
3. Add tests covering the policy and registry validation.
4. Land — and prove — the matching native command enforcement BEFORE any UI is
   shipped live against the policy.

The validation test rejects duplicate ids, missing required text, an incorrect
authority declaration, and missing enforcement functions.

## Why this lands dark now

Landing the read-side doorway (registry + mirrors) unblocks the permission /
visibility feature family to be **built and staged dark**, without waiting on
the unresolved provable-enforcement architecture. It ships zero new promise and
zero new exposure: nothing consumes it live, the mirrors are inert while
enforcement is absent, and the final on-switch still waits on the separate
enforcement decision.
