# Feature-boundary guard: security audit

## Result

The feature-boundary check is a build-time privacy rail, not a runtime access
control. Native code and platform guards must still enforce every sensitive
operation. Within the feature layer, however, four foundations use a narrow
public doorway to keep security-sensitive implementation details from becoming
available to arbitrary feature consumers. They are security consumers of this
guard.

The guard previously examined only importers in `src/features/**`. An app-shell
file or any test/fixture file could therefore import one of those internals
without a finding. The shared fix now checks `src/**`, `tests/**`, and
`foundation-contracts/**` (when that tree exists).

## Security consumers

| Foundation / row | Why its internal modules matter | Boundary-guard role | Evidence |
| --- | --- | --- | --- |
| Ask foundation | The public extension contract deliberately keeps Ask send-hook implementation private. Those internals include retrieval scope, citation verification, file-access checks, confidentiality choice, and the provider/egress path. | Security-relevant: prevents a new feature, app module, or fixture from coupling directly to a sensitive Ask internal instead of the reviewed public contract. | `src/features/ask/public.ts`; `src/features/ask/index.ts`; existing app and test deep imports now appear in the ratchet. |
| Calendar Write Part B | The feature root says the approved doorway is the only contract and keeps the orchestrator gates, provider boundary, and durable ledger internal. The native bridge is fail-closed and describes a write-scope OAuth exchange plus a capability-bearing grant. | Security-relevant: prevents an unreviewed caller from reaching the write machinery or native bridge by a private path. | `src/features/calendarWrite/index.ts`; `src/features/calendarWrite/nativeBridge.ts`. |
| CRM activity team feed | Its public contract explicitly keeps native storage, runtime guards, staged audit, and its private adapter inside the feature. The runtime handles sealed envelopes, matter keys, and seat-token relay calls. | Security-relevant: preserves the reviewed public composition surface around sealed-message and relay internals. | `src/features/crm-activity/team-feed/index.ts`; `src/features/crm-activity/notificationRuntime.ts`. |
| Audit feature | The public root exposes the supported audit registration/writing contract; exporter, views, and implementation details remain private. A private-path dependency could bypass the intended audit contract and make later integrity changes harder to enforce. | Security-relevant, but secondary: it protects the audit contract shape; durable integrity is still enforced below the feature layer. | `src/features/audit/index.ts`; `src/features/audit/auditWrite.ts`. |

## Checked and not a security consumer of this guard

| Area | Finding |
| --- | --- |
| Meetings | The sensitive-looking recording-consent functions are intentionally exported from `src/features/meetings/index.ts`. Existing direct imports such as `meetingStore` are architecture debt now ratcheted, but the feature-boundary guard is not the consent enforcement mechanism. |
| Egress | The real egress choke points live under `src/platform/privacy/**`, outside `src/features/**`; this guard cannot be their security boundary. Ask and Calendar Write are security consumers only for their feature-private composition contracts. |
| OAuth outside Calendar Write | OAuth pending state and provider credentials are in platform/native code. No separate feature-private OAuth foundation was found on this combined tip. |
| Owner/capability modules | No `foundation/owner` or separately named owner-binding capability feature module exists on this combined tip. The closest capability-bearing feature internal is Calendar Write's native bridge. |
| CRM permissions | Its public index explicitly says the renderer policy carries no security guarantee and native enforcement is authoritative. It is not counted as a security consumer. |

## Current coverage and baseline

The new scan reports 601 distinct current fingerprints: 64 pre-existing
cross-feature findings and 537 newly observed app/source/test findings (some
imports repeat in a file, so there are 624 raw findings). They were recorded in
the existing shrink-only baseline because this lane may not change feature or
test code. That preserves all existing allowed public-index forms and makes any
new private deep import fail the release check from every covered importer.

The focused test creates the same forbidden import from all of these places:

- `src/app/**`
- `src/app/fixtures/**`
- `tests/fixtures/**`
- `foundation-contracts/**`
- a sibling feature

Each receives a finding. Public root-index imports and the CRM composite
exception remain unchanged.
