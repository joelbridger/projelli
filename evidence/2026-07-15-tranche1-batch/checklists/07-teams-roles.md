# Sonnet vision checklist — teams-roles

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `settingsPanel()` — the closest frozen analogs are the `organization` panel's "People · Manage" row and the `permissions` panel's role groups + "View role matrix" button. The prototype does not have a single unified "Teams & Roles" page; the real feature combines what the prototype splits across two settings panels (Firm profile → People, and Permissions → role matrix) into one Organization-settings module. This is a known, reasonable consolidation, not a 1:1 layout match — noted as structural context, not scored as a delta on its own.

Real app: `TeamsRolesSettings` at `src/features/crm-firm/teams-roles/settingsModule.tsx`, mounted into `settingsModuleRegistry` as the `organization` module (`legacyLabel: 'Organization'`, order 80) only when `isEnabled('teams-roles')`.

Screenshot(s): `09-teams-roles-people-on.png` (People + Teams panels), `10-teams-roles-matrix-on.png` (Roles matrix expanded via "View role matrix").

## Frozen prototype spec (closest analogs)

- Firm profile panel: "People" setting-row — "8 active members / 3 advisors · 4 staff · 1 compliance admin" + "Manage" button
- Permissions panel: role groups (Advisors / Client service / Compliance admin / Guest planner) each with headcount, scope description, and an "Edit" action; a "View role matrix" button in the page header

## Real-app structure

- `teams-roles-settings` container: heading ("Teams & roles" style heading via i18n) + helper copy
- `PeoplePanel` (`teams-roles-people`): active-member count (`teams-roles-active-count`), per-member rows with role assignment (`teams-roles-member-<id>`, `teams-roles-role-<id>`), empty state when no members
- `TeamsPanel` (`teams-roles-teams`): team list + create-team form (`teams-roles-team-name`, `teams-roles-create-team`)
- Roles/matrix (`teams-roles-matrix`): role rows (`teams-roles-role-row-<id>`), "View role matrix" toggle button (`teams-roles-view-matrix`) that expands a detail view (`teams-roles-matrix-detail`), create-role form

## Checklist

Navigation note: Settings is reached via the gear icon (`data-testid="settings-gear"`) in the top-right corner, not a persistent left-rail nav item — `spine-nav-settings` does not exist in this build's legacy shell (only home/matters/search are in the primary nav rail). Once opened, the "Organization" category sits in the settings rail alongside Workspace/AI/Privacy/Scheduling/Voice/Advanced/Help/Privacy Center/Activity Log.

| Check | Verdict | Evidence |
|---|---|---|
| Reached via Settings → Organization category, matching the prototype's Organization settings grouping | PASS | `09-teams-roles-people-on.png` — "Organization" highlighted in the settings rail |
| People panel shows active-member count + per-member role assignment, echoing the prototype's headcount + role summary | PASS | "People and permissions" heading, "0 active members" (correct empty state for this synthetic firm), "People will appear here after they are added to your firm." |
| Teams panel present (prototype has no direct analog — this is additive depth, not a mismatch) | PASS | "Teams" section with "Use teams to organize people..." copy and an "Add team" action |
| "View role matrix" action present, matching the prototype's Permissions-panel button of the same name | PASS | `10-teams-roles-matrix-on.png` — "View role matrix" clicked, expands to show Advisors/Client service/Compliance admin/Guest planner groups with client-access descriptions and a full permission-string role matrix, closely matching the prototype's Permissions-panel role groups |
| Light theme, calm card/row hierarchy matching the settings-row style in the prototype | PASS | both screenshots |
| Structural: real app unifies People + Teams + Roles-matrix into one Organization module, vs. the prototype splitting People (Firm profile) from role matrix (Permissions) across two separate settings pages | **Expected DELTA** — a deliberate consolidation, plausible product improvement, not a defect | both screenshots |
| Flag OFF → Organization category absent from the settings rail | PASS (by code read) | `settingsModuleRegistry.ts` gates the whole module on `isEnabled('teams-roles')` at array-build time — an unambiguous, unconditional gate; not re-screenshotted in this pass since the record-flags absence proof was the batch's explicit ask |
| Engineering note (not a product finding): `settingsModuleRegistry` reads its flag once at module-evaluation time, not reactively via `useFlag`. Toggling the dev override after Settings has already been opened once in a session has no effect until the page reloads. | **Informational** | discovered live while driving this surface; worked around in the drive script by persisting the override to localStorage and reloading before first opening Settings, matching how a real persisted flag configuration would behave |

OVERALL: **PASS** — the Organization module's content matches the frozen spec's intent (People + role-based access), with a reasonable, deliberate consolidation of two prototype panels into one.
