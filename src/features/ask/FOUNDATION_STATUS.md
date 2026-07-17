# Ask Part A foundation status

This is the complete deliverables manifest for the reviewed base
`cb09c8c4f`. It records the honest narrower result. It does not call the lane a
complete Part A foundation while required owner contracts are absent.

The original lane owed a `COORDINATOR:` stop before saying it was ready. The
client-bar contract, shell contract, source owners, Meetings owner, action
authority/audit owners, and five destinations were not available from their
required public package indexes. This fix keeps those consumers unavailable
instead of inventing substitutes.

| Acceptance | Shipped now | Still unavailable; coordinator prerequisite |
| --- | --- | --- |
| A1 | Whole-firm conversation/scope projection. | `@/app/shell/registry` has no public index, and the real surface ID is `search` while the brief says `ask`. The shell owner must decide and land the public swap before `ask-shell-v1` launches. |
| A2 | Use-time client isolation is fail-closed, non-freezable, AND owner-only, on BOTH the read and write paths. Every use-time READ doorway reads the current client from ONE foundation-owned binding, not a caller-passed value; the persistence WRITE path re-resolves the active client LIVE at write time, so a save handle held across a client switch fails closed (it will not persist client-A state under B/none). State resolved under client A is refused the instant the owner switches, clears, or releases — even for a retained read handle or save handle. The capability that sets the binding (`createAskSharedClientOwner`) is off the public `@/features/ask` surface and there is no free `bind(access)`; establish-once refuses a second binder at runtime, so an ordinary consumer cannot set/replace/freeze the reader or restore client A. Opener tokens are sealed: a source carries only an opaque `sealAskOpenPath` reference; the raw token is released solely by the guarded `resolveAskCitationOpenPath`. Source-selection persistence is real. | No `useSharedClientContext` / `SharedClientContext`, CRM contact, document, or email descriptor owner doorway exists at this base. `createAskSharedClientOwner` is the empty, owner-only socket; the owner that would call it is absent, so the binding is unset and every client-scoped doorway fails closed. **Gap-1 (cross-lane pending):** the shared feature-boundary guard only inspects `src/features/*` importers, so its lint rule does not yet forbid a `src/app/` or fixtures-tree deep-import of `foundation/owner`; extending it is a separate coordinator-owned tooling lane. The runtime establish-once defense already blocks the data leak from every importer; `ownerImportBoundary.test.ts` asserts the lint rule and auto-greens when the guard fix lands. |
| A3 | Single/selected meeting eligibility uses the artifact's owner meeting reference. Range eligibility requires and checks date plus type. Mixed-client selected meetings fail closed. | `@/features/meetings` does not export `MeetingRef`, `MeetingSourceAdapter`, or `readApprovedMeetingArtifacts`. The meeting source and mode remain unregistered until those exact exports land. |
| A4 | Stable local citations, use-time stale-open rejection, and honest `no-local-answer` projection ship. | No concrete owner artifact can be claimed until A2/A3 prerequisites land. |
| A5 | The generic action registry accepts owner-supplied authority/audit types and wraps availability/execution with a live-client check, including actions retained before a switch. | `requireActionCapability`, `writeAuditAction`, and all five destination doorways are absent. No built-in action is registered, and the exact destination import fixtures cannot honestly compile yet. |
| A6 | Source, mode, and action public append paths have open-world third-contributor, order, malformed/duplicate, dark, and client-isolation tests. A compiling paved-path example ships outside Ask. | Concrete contributors remain governed by A2/A3/A5. |
| A7 | Generic consumer-shaped fixtures compile outside Ask, including the paved path. Dark paths are exercised through the public registry reads. | Exact shared-client, real-shell, four producer, five destination, permission, and audit fixtures are unavailable because their owner exports do not exist. Adding fake fixtures would repeat the reviewed defect. |

## Absent owner contracts (for coordinator adjudication)

The client-isolation guard is now genuinely fail-closed (A2). What remains
absent is not a fix-harder issue — it is a missing upstream foundation. These
exact owner doorways/contributors do NOT exist at base
`cb09c8c4f`, and Ask deliberately does not invent lookalikes for them:

- **Shared-client owner (partial upstream — read carefully):** A live shared-
  client store DOES exist at base: `@/platform/client-context`
  (`useClientContextStore`, `readSharedClientContext`) holds one
  `SharedClientIdentity { householdId, displayName }` for CRM, Ask, Meetings, and
  the shell bar, and can switch/clear it (it is intentionally not persisted). Ask
  already registers an `id: 'ask'` scope adapter against it. What is ABSENT is the
  brief's richer identity contract: `@/features/client-bar` exports no
  `useSharedClientContext` / `SharedClientContext`, and nothing supplies the
  `AskClientSnapshot { contactRef, matterId, revision }` (exact owner `ContactRef`
  + matter + revision) or the `AskOwnerIdentityAdapter` (client/meeting identity
  operations) that the binding needs. Ask ships an OWNER-ONLY socket
  (`createAskSharedClientOwner` — deliberately NOT on the public `@/features/ask`
  surface — plus the `AskClientUseAccess` shape); the small owner adapter that maps
  the platform `SharedClientIdentity` into an `AskClientUseAccess` and calls it —
  and the CRM/Meetings owner reference contracts it depends on — is what must land.
  Until it binds, every client-scoped Ask doorway fails closed by design, and no
  ordinary `@/features/ask` consumer can bind in the owner's place.
- **Shell registry:** there is no public `@/app/shell/registry` index. The real
  base surface descriptor is `id: 'search'`
  (`src/app/shell/registry/legacyAppSurfaceDescriptors.tsx`); the brief's
  `id: 'ask'` does not exist. The shell owner must decide the ID and publish the
  swap before `ask-shell-v1`.
- **Source producers:** no CRM-contact, document, meeting-artifact, or
  email-descriptor source owner/adapter exports. `askSourceRegistry` therefore
  has no registered contributor.
- **Meetings owner:** `@/features/meetings` exports no `MeetingRef`,
  `MeetingSourceAdapter`, or `readApprovedMeetingArtifacts`.
- **Answer-action owners:** `requireActionCapability`, `writeAuditAction`, and
  all five answer-action destination doorways are absent;
  `askAnswerActionRegistry` has no built-in action.

Recommended framing: this is the WB-031 / WB-014 honest-partial precedent —
**isolation-complete, owner-pending**. Part A can land as a bounded honest
partial (dependents stay grounded, nothing pretends the absent owners exist), or
wait for the upstream owners; the isolation gate itself is no longer red.

Part A touches no Rust, native command, migration, provider, credential,
connector retrieval, egress, send, or committed-write path. Part B stays
parked and unreserved.
