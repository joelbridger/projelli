# Meetings population contract handoff

## Now supportable

The bridge supports the truthful Option-A amendments to the Meetings Shell v1
spec: §3 has separate canonical and legacy populations; §4.3 can list
canonical meetings created through this path using the authorized firm reader;
§4.4 limits Actions to canonical-linked meetings; §5 opens legacy detail only
for an explicit validated link; §7 uses the Meetings-workspace empty meaning;
§10 DERIVED item 5 is qualified to linked records; §12 can prove a linked new
meeting opens while an unlinked legacy meeting remains in its client screen;
and §13 must not promise every historical meeting or “any meeting anywhere.”

Legacy-row consumers can also ask the public Meetings doorway for one sealed,
read-only status: a visible folder is either linked to exactly one canonical
meeting reference or is truthfully folder-only. The answer comes from one fresh
canonical-link-key snapshot for the active client; it does not open, project,
or load a canonical meeting, and it refuses malformed, duplicate, cross-client,
or stale-client answers rather than guessing. The reference is routing-only:
the existing resolver still owns later client selection and opening.

## Authority model (post-review hardening)

Identity is DERIVED, never caller-supplied. The population service takes only the
live-record port; it derives the Matter set from the trusted matter store and the
filesystem from the active `WorkspaceService`, resolves the exactly-one Matter for
the record's household, and mints an un-forgeable (sealed) `MeetingOpenTarget`
and firm-directory grant that a feature consumer cannot hand-construct. See
`SKILL.md` → "Populate and open canonical meetings honestly" and the boundary
probes in `contract.test.ts` (multi-Matter ambiguity, forged identity object,
ancestor-symlink escape, concurrent linking) plus the real host-open probe in
`MeetingEntry.hostIdentity.test.ts`.

## Owed follow-on

`advisor-link-ui` remains owed to the Meetings Shell owner. It must give an
advisor an explicit review-and-link flow for legacy meetings that cannot pass
the exactly-one-household anchor. It may not infer a link from a folder name,
title, date, or calendar id. Until that work lands, ambiguous and unlinked
legacy meetings remain legacy-only.

The `meetings-shell-v1` UI relaunch itself is also owed (held per bridge-probe
ruling D-then-A): this lane delivers the population/open-target CONTRACT that
unblocks a truthful relaunch, not the shell screen. The manifest marks the shell
`coordinator-blocked` accordingly.
