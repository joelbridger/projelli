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
| A2 | Generic client snapshots fail closed for current-client and chosen-source state after A → B or A → none. Source selection persistence is real, and every public source read re-reads the live client at use time. | No `useSharedClientContext` / `SharedClientContext`, CRM contact, document, or email descriptor owner doorway exists at this base. No concrete source contributor is registered. |
| A3 | Single/selected meeting eligibility uses the artifact's owner meeting reference. Range eligibility requires and checks date plus type. Mixed-client selected meetings fail closed. | `@/features/meetings` does not export `MeetingRef`, `MeetingSourceAdapter`, or `readApprovedMeetingArtifacts`. The meeting source and mode remain unregistered until those exact exports land. |
| A4 | Stable local citations, use-time stale-open rejection, and honest `no-local-answer` projection ship. | No concrete owner artifact can be claimed until A2/A3 prerequisites land. |
| A5 | The generic action registry accepts owner-supplied authority/audit types and wraps availability/execution with a live-client check, including actions retained before a switch. | `requireActionCapability`, `writeAuditAction`, and all five destination doorways are absent. No built-in action is registered, and the exact destination import fixtures cannot honestly compile yet. |
| A6 | Source, mode, and action public append paths have open-world third-contributor, order, malformed/duplicate, dark, and client-isolation tests. A compiling paved-path example ships outside Ask. | Concrete contributors remain governed by A2/A3/A5. |
| A7 | Generic consumer-shaped fixtures compile outside Ask, including the paved path. Dark paths are exercised through the public registry reads. | Exact shared-client, real-shell, four producer, five destination, permission, and audit fixtures are unavailable because their owner exports do not exist. Adding fake fixtures would repeat the reviewed defect. |

Part A touches no Rust, native command, migration, provider, credential,
connector retrieval, egress, send, or committed-write path. Part B stays
parked and unreserved.
