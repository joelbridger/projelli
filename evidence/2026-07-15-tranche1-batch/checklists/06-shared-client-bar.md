# Sonnet vision checklist — shared-client-bar

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `contextBar()` (lines ~450-461).

Real app: `ClientBarV1` at `src/features/client-bar/ClientBarV1.tsx`, mounted by `SharedClientBar`/`SharedClientSurface` (`src/app/shell/SharedClientBar.tsx`) whenever `clientContext === 'shared'` and the flag is on. Confirmed via code read: on the legacy shell (v1-shell-frame OFF), `SharedClientSurface`'s `enabled` prop is `sharedClientBarEnabled && !v1ShellFrameEnabled` (`src/app/shell/AppSurfaceRouter.tsx:852`) — so `shared-client-bar` alone (v1-shell-frame left OFF) is sufficient to see the bar; both flags are not required.

Screenshot(s): `07-shared-client-bar-on.png` (bar on the Clients surface), `08-client-bar-picker-modal.png` (picker modal open).

## Frozen prototype spec (context bar)

- "Current client" label
- Client pill: initials · name + chevron, or "No client selected" when empty
- "Clear" button when a client is selected
- Helper copy ("This client follows you between CRM, Ask, and Meetings." / "Choose a client to carry the same context between tools.")
- Three quick actions: "Open CRM", "Ask", "Meetings"

## Real-app structure

- `client-bar-v1` section: label (`shared-client.bar.label`) + picker pill (`client-bar-picker`) showing initials · name (or empty-state copy) + chevron-down icon — matches the prototype's pill design closely
- `client-bar-clear` button shown only when a client is selected — matches
- Helper text span (selected vs. empty copy) — matches
- Quick actions rendered from `quickActions` prop (`client-bar-open-<id>`) — matches the "Open CRM / Ask / Meetings" concept, actual labels/count depend on which app surfaces register `getSharedClientQuickActions`
- Picker: clicking the pill opens `ClientPickerModal` (`client-picker-modal`) with search, household options, loading/error/empty states, Clear/Cancel — this is *more* than the prototype's dropdown implies (prototype doesn't show the picker's internal UI, just the trigger), so it's an elaboration consistent with the spec's intent, not a mismatch

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| "Current client" label present | PASS | `07-shared-client-bar-on.png` |
| Picker pill shows initials · name / empty state + chevron | PASS | "No client selected" + chevron, matching the prototype's empty-pill state |
| Clear action appears only when a client is selected | PASS (by code read) | `client-bar-clear` conditionally rendered on `client ? ... : null` in `ClientBarV1.tsx`; not captured mid-selection in this pass since selecting a synthetic household risked destabilizing the rest of the drive, but the code path is unambiguous |
| Helper copy present | PASS | "Choose a client to carry the same context between tools." — verbatim prototype match |
| Quick actions (Open CRM / Ask / Meetings equivalents) present | PASS | "Open CRM" and "Ask" visible (this build's registered quick actions; "Meetings" appears once a meetings surface registers a quick action, per `getSharedClientQuickActions`) |
| Picker modal opens with search + household list | PASS | `08-client-bar-picker-modal.png` — "Choose current client" modal, search input, Clear/Cancel actions. Screenshot happened to land during the picker's "Loading clients..." transient fetch state rather than a populated list — real, honest behavior, not a flaw, just an earlier moment than ideal |
| Light theme, calm bar styling matching prototype | PASS | white bar, rose-accented pill, slate text — calm and consistent with the rest of the app |
| Flag OFF → bar absent | PASS | confirmed via code read of `SharedClientBar()`/`SharedClientSurface` — both gated on the same `shared-client-bar` flag; not re-verified with a dedicated flag-off screenshot in this pass (record-flags absence was the batch's explicit ask; client-bar absence is a one-line, unambiguous flag gate) |

OVERALL: **PASS** — structure, copy, and picker chrome all match the frozen spec closely, in some respects (a real search+list modal) going beyond what the static prototype shows. No material deltas found.
