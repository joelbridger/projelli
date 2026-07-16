# IA map — prototype intent and landed shell reality

**Purpose.** This is the one-page map a design reviewer uses to ask: *Where does this feature live in an advisor's work, what does it lead to, and does it use the same language as the screens beside it?*

**Snapshot.** Intent is the frozen Fable v2 prototype at `/home/jameson/lantern/design/fable-v2-lantern/prototypes/fable-v2/index.html`. Reality is the landed app shell at `64723645e`, read from `/home/jameson/lantern/app/integration/src`. “Landed” below means registered and routed at that exact tip; it does **not** mean every feature flag is on or every planned screen exists.

## The short version

The approved prototype is an advisor's daily workspace with six left-rail stops: **Today, Meetings, Clients, Inbox, Ask, Firm**, plus **System** at the bottom. It puts the day's meetings, follow-ups, client room, mail, firm work, and settings in one visible journey.

The landed shell has a much narrower visible rail: **Home, Clients, Ask**. It does contain more routable screens, but Scheduling, Settings, Documents, Email, Workflows, Activity Log, Privacy Center, AI Assistant, Research, and Trash are hidden or reached by another doorway. This is the main coherence risk: a feature can be well made yet feel stranded because its prototype neighbor is not visible in the real app.

## 1. Screen inventory

### A. Approved prototype intent — visible navigation order

| Order | Screen and major surfaces | What it is for | Beside it and its hand-offs |
|---|---|---|---|
| 1 | **Today** — daily brief, meeting cards and prep, judgment/approval cards, work list, team pulse | Start the day by seeing what matters now and choosing the next action. | Before: none. After: Meetings. Opens a client room, meeting prep/recording, Inbox, Ask, Firm activity, and project work. |
| 2 | **Meetings** — board by lifecycle, Calendar view, meeting detail, prep brief, live recording, review/delivery | Prepare, run, review, and finish client meetings in one lifecycle. | Between Today and Clients. Links to the client room, calendar event editor, recording, follow-up task, and send/delivery. |
| 3 | **Clients** — client list, priority list, client room tabs: Overview, Plan, People, Accounts, Notes, Meetings, Files, Ask, History | Keep the household's facts, work, documents, meetings, and context together. | Between Meetings and Inbox. Comes from Today/Meetings/Inbox; opens scoped Ask, a meeting, files, tasks, workflows, opportunities, and history. |
| 4 | **Inbox** — triage/filed mail, linked client, file-to-client action | Turn incoming email into client context instead of a separate inbox pile. | Between Clients and Ask. Enters from Today; sends mail into the client room and its history. |
| 5 | **Ask** — firm or client scope, answer thread, cited sources, proposed task/workflow, source peek | Ask a question across the right client information and turn a useful answer into work. | Between Inbox and Firm. Opens sources, narrows/widens client scope, and proposes tasks or workflows that return to Today/Clients. |
| 6 | **Firm** — activity feed, internal projects, pipeline, saved views, workflow templates, task templates | Run shared firm work that is not a single household record. | Between Ask and System. Today opens the feed and projects; it feeds tasks back to Today's work list and workflows into client work. |
| Bottom | **System** — firm administration, access/teams, custom fields, data quality, connections | Manage the firm, its shared rules, and connected services without interrupting daily work. | Below the six daily stops. Receives settings/data-quality links from Clients; owns calendar connection management and organization-wide rules. |

Prototype supporting interactions are not separate destinations: global Find/command palette, notifications/approvals, the meeting/event sheet, side peek, and overlays. They preserve the underlying screen rather than becoming a new place.

### B. Landed shell reality — all registered top-level destinations

The first three are the **only current left-rail destinations**, in this order. “Utility” means registered but not in the visible rail. “Hidden” means programmatic or embedded-only at this tip.

| Order / placement | Landed screen and major sub-surfaces | What it is for | Neighbor and hand-off picture | Mount/composition point |
|---|---|---|---|---|
| 1 / left rail | **Home** — orientation cards, current-client card, starting links, optional feature widgets | Give a simple starting point and send the advisor to Clients, Ask, or Scheduling. | Before: none; after: Clients. Links to Clients, Ask, and hidden Scheduling; it is not the prototype's working Today dashboard. | `home` descriptor → `HomeSurfaceFlagGate` → `HomeOrientationSurface` or CRM home fallback. |
| 2 / left rail | **Clients** — household directory and household record. Record tabs: Client Map, Timeline, Documents, Email, Meeting Notes, Meetings, Reviews, Activity; optional member rail. | Find a household and work in its record. | Between Home and Ask. Receives the shared client selection; links to scoped documents, email, meeting material, activity, and record add actions. | `matters` descriptor → `ClientsSurface` → `DirectorySurface` or `HouseholdRecordSurface` → `householdTabRegistry`. |
| 3 / left rail | **Ask** — “Ask with citations” and “Search saved records.” | Ask questions of saved client information and inspect cited records. | After Clients; no visible next rail neighbor. Opens documents/email sources and can save an answer as a document. | `search` descriptor → `CrmAskSurface`. |
| 4 / utility | **Scheduling** — booking link, upcoming booking requests, availability, meeting types, next open slots, editor panel. | Set up and respond to appointment booking, not daily meeting work. | Not beside any visible rail item. Home links here; it belongs near System/Connections in the prototype, but is currently a separate hidden route. | `scheduling` descriptor → `SchedulingHome`. |
| 5 / utility | **Settings** — Workspace, AI, Privacy, Scheduling, Voice, Advanced, Help; nested Privacy Center and Activity Log. | Change product and firm settings. | Not visible in the rail. It is the nearest landed home for System-style administration and connections. | `settings` descriptor → `SettingsV1Surface`/`SettingsContent`; router injects Privacy Center and Activity Log sections. |
| 6 / hidden | **Documents** — file browser/editor, client-scoped embedded documents. | Open, edit, create, import, and manage client files. | Reached from a client, Ask citation, or workflow result; it should return the advisor to the client context. | `files` descriptor → `DocumentsHome`; router also embeds it in client-owned contexts. |
| 7 / hidden | **Email** — mail workspace, client-scoped embedded email. | Read, file, and save mail into the right client context. | Prototype's Inbox neighbor is missing from the rail. It is reached from client context or Ask source opening. | `email` descriptor → lazy `EmailWorkspace`; also built scoped to a client. |
| 8 / hidden | **Workflows** — template rail, workflow detail, run progress, recent output. | Start and manage repeatable firm workflows. | Prototype puts templates under Firm and workflow actions in client work; here it is routable but invisible. Output opens Documents. | `workflows` descriptor → `AssociateHome`. |
| 9 / hidden | **Activity Log** — activity entries, integrity status, verify/repair actions; may be client-scoped. | Inspect recorded history and its integrity. | Prototype History belongs inside the client room and Firm activity is visible; this is a separate hidden route plus Settings section. | `audit` descriptor → lazy `AuditHome`; router can also build a client-scoped activity view. |
| 10 / hidden | **Privacy Center** — privacy/audit information for the active client. | Explain and inspect privacy-related information. | Prototype places trust information in System; this is separately routable and also nested in Settings. | `privacy` descriptor → lazy `PrivacyCenterHome`. |
| 11 / hidden | **AI Assistant** — legacy main panel. | Use the older AI workspace/editor host. | No prototype rail equivalent; overlaps the job of Ask without sharing its visible doorway. | `ai-assistant` descriptor → `LegacyMainPanelSurface` → `MainPanel`. |
| 12 / hidden | **Research** — legacy main panel. | Use the older research workspace/editor host. | No prototype rail equivalent; it shares the same mount as AI Assistant. | `research` descriptor → `LegacyMainPanelSurface` → `MainPanel`. |
| 13 / hidden | **Trash** — legacy main panel. | Recover or manage deleted workspace items. | Prototype's data-quality/recovery work belongs under System; this is a hidden route. | `trash` descriptor → `LegacyMainPanelSurface` → `MainPanel`. |

The authoritative shell list is `appSurfaceRegistry`; the visible rail is `Spine`, which asks that registry only for `primary` entries. The client-record tab list is `householdTabRegistry`. These are supporting pointers, not a second IA.

## 2. Advisor journeys

These chains name the desired work path first, then show the nearest landed path where it is different. A reviewer should inspect the screens in the chain together, not as isolated screenshots.

1. **Morning review → follow-up work**
   - Intent: **Today → meeting prep → client room → task/work list → Firm activity**.
   - Landed: **Home → Clients → household record → Activity or Ask**. The daily brief, visible work list, and visible Firm feed are absent from the rail journey.

2. **New client → record → task → workflow → calendar**
   - Intent: **Clients → new client sheet → client room → + Add task/workflow → Firm templates → Meetings/Calendar**.
   - Landed: **Clients directory → household record → Add to this household → Home handoff for task/opportunity/workflow → hidden Workflows or hidden Scheduling**. The last two steps lose a visible, continuous path.

3. **Prepare and run a client meeting**
   - Intent: **Today or Meetings → meeting detail/prep → Record → review → follow-up task → client room/history**.
   - Landed: **Clients → household Meetings/Meeting Notes → client record → Activity/Documents**. There is no top-level Meetings destination at this tip.

4. **Email becomes client work**
   - Intent: **Inbox → file to client → client History → task or note → Today work list**.
   - Landed: **hidden Email (usually from client context) → scoped client Email/Documents → household record → Activity**. The Inbox-to-work-list loop has no visible rail path.

5. **Ask a question and act on the answer**
   - Intent: **client room or Today → Ask in client/firm scope → cited source → proposed task/workflow → Today or Firm**.
   - Landed: **Clients (select household) → Ask → cited document/email → Documents/Email or saved document**. Ask is visible, but the work-destination half is only partly connected and not visible as Today/Firm.

6. **Schedule a new appointment safely**
   - Intent: **Meetings Calendar → New event sheet → linked client → meeting detail → Today prep**.
   - Landed today: **Home → hidden Scheduling → booking/availability tools**; the in-flight calendar family is intended to supply the real grid/editor path. The event-to-client-to-day loop is not yet a landed journey at `64723645e`.

7. **Run firm administration without derailing client work**
   - Intent: **System → Connections / access / fields / data quality → return to Clients or Meetings**.
   - Landed: **hidden Settings → nested settings section or separate hidden Privacy/Activity route → Clients**. The job exists, but the System doorway is not visible.

## 3. Divergences that need honest design attention

| # | Prototype intent | Landed reality at `64723645e` | Why it matters to coherence |
|---:|---|---|---|
| 1 | Today is the first, working daily dashboard. | Home is a light orientation screen, not Today. | The product loses the clear “start my day” job and the hand-offs that organize the prototype. |
| 2 | Meetings is a primary rail destination with board, calendar, prep, recording, review, and delivery. | No visible Meetings rail destination exists. Meeting material is split across client record tabs, hidden Scheduling, and legacy surfaces. | The meeting lifecycle has no single home or obvious neighbor. |
| 3 | Clients is one rich client room with seven named tabs. | Clients is a directory plus a different, broader set of record tabs. | Similar names hide a different mental model; reviewers must compare the whole record, not assume tab parity. |
| 4 | Inbox is a primary rail stop feeding client history and today's work. | Email is hidden/programmatic or embedded per client. | Mail is no longer a predictable stop in the daily loop. |
| 5 | Firm is a primary rail stop for feed, projects, pipelines, views, and templates. | Workflows are hidden; no single visible Firm surface owns the rest. | Firm-wide work has been scattered or is absent from the current navigation. |
| 6 | System is a visible bottom-rail administration home. | Settings is utility-only; Privacy and Activity are both nested there and separately hidden routes. | One job has several doorways, making placement and return paths unclear. |
| 7 | Calendar lives inside Meetings and shares its board/calendar control and client meeting context. | Scheduling is a separate utility route focused on booking; no real calendar grid is in the shell at this tip. | A calendar feature can accidentally become a second scheduling product. |
| 8 | Ask proposes tasks/workflows that visibly land in Today or Firm. | Ask is visible, but its obvious visible destinations are Documents/Email; task/workflow destinations are not rail neighbors. | The answer-to-action loop can feel unfinished even if each screen works. |
| 9 | Find, sheets, peeks, and notifications are supporting layers over the current screen. | AI Assistant, Research, and Trash are full hidden destinations sharing a legacy main-panel host. | These extra places do not have a prototype counterpart or a clear role in the advisor's daily map. |
| 10 | Connected calendar status is shown where meeting work happens; connection management is under System. | Calendar connection and booking settings are separate technical routes; a current calendar connector is read-only at this snapshot. | Copy and status need to be especially truthful, and the future write path must not look already complete. |
| 11 | Client history is a client-room tab; Firm activity is a distinct visible feed. | Activity Log is a hidden global route, a Settings section, and can be client-scoped. | One label covers several scopes, so a reviewer must check the scope signal and return route. |
| 12 | The prototype has six everyday rail stops plus System. | The landed registry has thirteen destinations, but only three are shown in the rail. | Navigation order in code is not the user's navigation order; hidden routes cannot substitute for an understandable IA. |

## 4. Where new features live

This section separates **the intended product home** from **the technical mount planned for the in-flight work**. If those disagree, reviewers should call it out rather than quietly accepting a second home.

| In-flight family or V1 pillar | Intended place in the advisor journey | Planned/landed map mount | Coherence checks with neighbors |
|---|---|---|---|
| **Calendar grid** (month/week/day) | The meeting-planning step: **Meetings → Calendar → open event or client**. | In-flight mount is the append-only `schedulingSurfaceRegistry`, under the current hidden **Scheduling** route. It is not a registered top-level calendar screen at `64723645e`. | It must look like the prototype Meetings calendar, but its current neighbors are booking tools, not meeting prep/review. Do not let it become a detached second calendar. |
| **Calendar event list** | An alternate view of the same date range: **Calendar Grid ↔ List → event detail/editor**. | Registers inside the calendar-grid view mount, not as a top-level route. | It keeps the same toolbar, date range, filters, and selected event; it must not become another “Board” product. |
| **Add/edit event** | A focused action from **Calendar → event sheet → linked client/meeting**. | Registers through `schedulingSurfaceRegistry`; the editor is a local sheet/overlay, not a page. | Preserve the grid behind it; use the same small truthful sync/capability wording as its calendar neighbor. |
| **Record quick-add event** | Contextual action from **Clients → household record → Add → event editor → Calendar/meeting**. | Adds a record-owned action through the household add-action/record extension path, then calls the same public calendar draft/create doorway. | This is not a second global “New event” button. It needs the household context to survive into the same editor used by the grid. |
| **Booking availability** | Firm setup, not daily work: **System/Settings → booking availability → public booking link**. | Contributes to the Settings mount; it uses the calendar capability/availability model. | It should read as quiet administration beside scheduling settings and connections, not as another daily dashboard. |
| **Public booking page** | Outside the advisor's app: **shared booking link → choose time → confirmation**. | Separate public-page registry/route; it consumes availability through a narrow adapter and has no internal app rail. | It is deliberately not an internal app screen. Never leak client, calendar, provider, or staff details into it. |
| **Pillar 2: UI redesign** | Rebuild the visible advisor frame so CRM, Ask, and Meetings are distinct familiar tools tied by a shared current-client bar. | Current shell anchor: `appSurfaceRegistry`, `Spine`, and `SharedClientSurface`; the real visible rail still needs to reach the intended destinations. | Judge placement first: the redesigned screen must have a visible, understandable neighbor and return path. |
| **Pillar 2b: parity work** | Mostly **Clients** and the missing **Firm/Meetings/Calendar** work loops: record depth, tasks/workflows, pipelines, reports, projects, firm feed. | Current record extensions mount in household registries; task/workflow work hands into CRM Home; several intended Firm/Meetings homes are not visible at this snapshot. | A feature should join an existing record or firm journey, not create another hidden top-level island. |
| **Pillar 2c: meeting intelligence** | **Meetings → meeting detail → client signals** and **Ask across meetings**. | Needs a real top-level/record Meetings mount; today the closest places are household Meeting Notes/Meetings and hidden legacy routes. | Do not bury meeting intelligence in Settings or make it a separate analytics product; its neighbors are prep, recording, review, and client context. |
| **Pillar 3: two-way calendar sync** | Supports the same **Calendar → event editor → review/approval → updated meeting** journey. | Connector/settings permission work plus the calendar foundation/write boundary; it should power the calendar/editor rather than become its own destination. | Status must tell the truth about read-only versus write-enabled state. Approval and conflict checks belong next to the event decision, not in a distant settings page. |
| **Pillar 3b: branded booking pages** | **Settings availability → public booking page → home calendar → meeting prep**. | Availability sits in Settings; public booking is outside the internal shell; the event ultimately belongs in the chosen home calendar. | Keep internal setup, public choice, and advisor follow-up as three clear contexts—do not make the public page look like a miniature admin app. |
| **Pillar 4: Schwab pre-fill** | **Clients → household record → Reviews → field-by-field approval → local prep packet**. | The optional **Reviews** tab in `householdTabRegistry` gates the pre-fill review component. | It belongs beside household facts/accounts, not a global paperwork or Settings screen. Its approval grammar should match record editing and clearly state that the output is a prep packet, not an official application. |

## Reviewer use

For every screenshot or feature review, answer these four questions before judging polish:

1. What exact advisor job begins here?
2. What screen brought the advisor here, and what is the natural next screen?
3. Is this a visible destination, a record sub-surface, a settings surface, a temporary sheet, or a public page?
4. Does its title, density, actions, status language, and return path match those neighbors?

If the map says a destination is hidden, missing, or split across several places, record that as an IA finding. A good-looking screen does not fix a broken journey.
