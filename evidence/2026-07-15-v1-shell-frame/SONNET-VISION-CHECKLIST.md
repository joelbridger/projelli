# Sonnet visual acceptance checklist

Reviewer: Claude Sonnet, high effort, independent read-only pass

Evidence clarification: the wording for item 4 was narrowed after Codex review so it does not imply the later P0-C picker/action visual exists in this referenced build. The Sonnet verdict for the shell frame remains unchanged.

Screenshot: `evidence/2026-07-15-v1-shell-frame/02-flag-on-v1-shell-clients.png`

Build SHA: `dddec8efeb3f2c6cdbb21aa31d978739dfae8cdf`

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, CSS lines 35-85 and shell markup around lines 407-467.

## 1. Permanent global nav rail: PARTIAL

- Structure: PASS. Brand block, Workspace label, stacked destinations, active state, and bottom-pinned utility/firm group match the prototype's information architecture.
- Active state: PASS. Clients is clearly selected.
- Destination coverage: PARTIAL. The current registry supplies Home, Clients, Ask, Scheduling, and Settings. The frozen prototype shows Home, CRM, Ask, Meetings, and Settings. Meetings has no `appSurfaceRegistry` descriptor in this reviewed build; the frame correctly renders the registry and does not invent an item. This is a registry rollout dependency, not a shell-frame defect.
- Brand text: the built fixture shows the current configured product identity rather than the prototype's Lantern placeholder. This is not a frame defect.

## 2. Top bar: PASS

- Breadcrumb is present: Workspace / Clients.
- Search/command trigger is present with a visible Command-K affordance.
- Stable notification-bell slot is present.
- Avatar is present at the right edge.
- The existing local-AI privacy indicator is additive and does not overlap or clip the shell.

## 3. Firm card: PASS

Northstar Advisory and `Firm workspace · 8 people` appear at the bottom of the rail, matching the frozen prototype's placement and summary structure.

## 4. Shared client-bar reserved row: PARTIAL, non-blocking

The row exists directly below the top bar, with Current client and No client selected. The prototype also contains helper copy and Open CRM / Ask / Meetings actions. Those later P0-C visuals/actions are not present in this referenced build and are not accepted by this checklist; this lane owns only the conditional row and slot. No frame defect was found.

## 5. Overall shell grid and hierarchy: PASS

The permanent rail plus top-bar/client-bar/content rows match the prototype's shell hierarchy. The main content remains correctly bounded and scrollable, with no clipping in the reviewed screenshot.

## Overall verdict

ACCEPT. No merge-blocking shell-frame defect was found. The partial items are rollout dependencies owned by registry/SharedClientBar work, not faults in this frame.
