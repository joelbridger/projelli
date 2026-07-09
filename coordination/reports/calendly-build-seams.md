](/home/jameson/lp-ux-integrate/src/platform/utils/calendar-commands.ts:128) exposes `calendarListEvents`.
- [commands.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/commands.rs:554) syncs Outlook, Google, and ICS.
- [graph_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/graph_source.rs:61) reads Microsoft `/me/calendarView`.
- [google_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/google_source.rs:49) reads Google `/calendars/primary/events`.
- [store.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/store.rs:188) lists events from the local encrypted calendar DB.
Calendar write is MISSING. I found no create/update/delete event command. The UI also says read-only: [CalendarConnect.tsx](/home/jameson/lp-ux-integrate/src/platform/connectors/calendar/CalendarConnect.tsx:347).
Build shape: add new Tauri commands like `calendar_create_event`, `calendar_update_event`, maybe `calendar_delete_event`, plus provider-specific Graph/Google write clients.
**2. M365 + Google OAuth Scopes**
Status: PARTIAL
Current calendar scopes are read-only:
- Microsoft: `offline_access openid User.Read Calendars.Read` in [oauth.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/oauth.rs:6).
- Google: `openid email https://www.googleapis.com/auth/calendar.readonly` in [oauth.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/oauth.rs:7).
Related scopes:
- OneDrive asks only file/site read scopes: [onedrive/oauth.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/onedrive/oauth.rs:1).
- M365 mail already asks `Mail.Send`: [mail/oauth.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/oauth.rs:1).
- Gmail already asks Gmail send/compose scopes: [gmail/oauth.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/gmail/oauth.rs:12).
Build shape: change calendar scopes to Microsoft `Calendars.ReadWrite` and Google `calendar.events` or broader calendar write. Existing users must reconnect, because their saved permission token is read-only. Tests and read-only UI copy must change too.
**3. Meeting-Link Creation**
Status: MISSING
The app detects existing meeting links. It does not create Teams, Zoom, or Google Meet links.
Existing detection:
- Microsoft reads `onlineMeeting.joinUrl`: [graph_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/graph_source.rs:224).
- Google reads `conferenceData.entryPoints` / `hangoutLink`: [google_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/google_source.rs:196).
- Platform detection supports Teams, Zoom, Meet: [meetingPlatform.ts](/home/jameson/lp-ux-integrate/src/features/meetings/noticeCard/meetingPlatform.ts:25).
- Auto-join only supports Teams and Zoom: [noticeCardTypes.ts](/home/jameson/lp-ux-integrate/src/features/meetings/noticeCard/noticeCardTypes.ts:23).
Build shape: create calendar events with online meeting data. For Microsoft, that likely means Graph event creation with online meeting fields. For Google, event insert with conference data. Zoom would need its own OAuth/app path unless using calendar-created Zoom links already present.
**4. Email Send Infra**
Status: EXISTS
Outbound email exists from the desktop app:
- `mail_send` supports M365, Gmail, and IMAP/SMTP: [send.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/send.rs:37).
- Frontend wrapper: [mail-commands.ts](/home/jameson/lp-ux-integrate/src/platform/utils/mail-commands.ts:552).
- M365 sends through Graph `/me/sendMail`: [graph.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/graph.rs:333).
- Gmail sends through `/gmail/v1/users/me/messages/send`: [api.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/gmail/api.rs:239).
- IMAP accounts send through SMTP: [imap/send.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/imap/send.rs:37).
- Meeting artifact sending uses this path: [MeetingSendPanel.tsx](/home/jameson/lp-ux-integrate/src/features/meetings/MeetingSendPanel.tsx:425).
Draft saving exists for M365/Gmail only: [send.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/mail/send.rs:304).
`keepance-send` appears only in docs, not product code. It is not the in-app booking email path.
Build shape: desktop-confirmed booking emails can use existing `mailSend`. True automatic reminders need server-side email, or they only work while the advisor app is open.
**5. Firm Backend**
Status: EXISTS, but no booking routes
The firm backend is real app-owned server code:
- Backend purpose: identity, licensing, E2EE sync relay, Assured proxy: [backend README](/home/jameson/lp-ux-integrate/backend/README.md:1).
- Routes live in [server.ts](/home/jameson/lp-ux-integrate/backend/src/server.ts:90).
- It has auth, SSO, seats, matters, relay, Assured AI, devices, webhooks: [server.ts](/home/jameson/lp-ux-integrate/backend/src/server.ts:154).
- Relay stores encrypted bytes only: [README.md](/home/jameson/lp-ux-integrate/backend/README.md:233).
- SSO exists: [sso.ts](/home/jameson/lp-ux-integrate/backend/src/routes/sso.ts:1).
Host naming wrinkle: old docs say live `api.keepance.com`: [firm-provisioning.md](/home/jameson/lp-ux-integrate/docs/operations/2026-06-10-firm-provisioning.md:5). Current fork code points to `https://api.lanternplatform.app`: [brand.ts](/home/jameson/lp-ux-integrate/src/config/brand.ts:67), [firmConfig.ts](/home/jameson/lp-ux-integrate/src/platform/firm/firmConfig.ts:10).
Build shape: this is the best place to host a public booking page, if it stores only booking-safe data: advisor slug, bookable windows, busy-slot snapshots, booking requests, and confirmation status. It should not store client documents, notes, or private files.
**6. Existing Availability / Scheduling / Booking Data**
Status: MISSING
I found no booking page, booking model, availability rule model, slot model, office-hours model, or public scheduling UI in `src`, `src-tauri`, or `backend`.
Near misses:
- Synced calendar events: [CalendarEvent](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/model.rs:30).
- Today’s meetings UI: [TodaysMeetingsStrip.tsx](/home/jameson/lp-ux-integrate/src/features/meetings/TodaysMeetingsStrip.tsx:72).
- Auto-join preferences: [autoJoinSettings.ts](/home/jameson/lp-ux-integrate/src/platform/connectors/calendar/autoJoinSettings.ts:4).
- Calendly connector imports scheduled events read-only, but does not create booking pages: [calendly/client.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendly/client.rs:1).
Build shape: add new booking domain objects. Do not try to reuse auto-join prefs as availability.
**7. Timezone + Advisor Identity**
Status: PARTIAL
Timezone:
- Calendar data is normalized to UTC: [model.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/model.rs:38).
- Outlook requests UTC from Graph: [graph_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/graph_source.rs:87).
- Google handles event timezone fields: [google_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/google_source.rs:138).
- ICS has timezone parsing and DST handling: [ics_source.rs](/home/jameson/lp-ux-integrate/src-tauri/src/commands/calendar/ics_source.rs:178).
- “Today” uses the local computer’s timezone, then converts to UTC: [todayWindow.ts](/home/jameson/lp-ux-integrate/src/features/meetings/todayWindow.ts:9).
Advisor identity:
- Local profile has solo name/avatar and firm name/logo: [profileStore.ts](/home/jameson/lp-ux-integrate/src/platform/profile/profileStore.ts:13).
- I found no advisor timezone, booking slug, public profile, working hours, or booking identity model.
Build shape: booking needs an explicit advisor profile: public name, public booking URL slug, timezone, default meeting length, buffers, working hours, and connected calendar choice.
**Key Architectural Tension**
A public booking page cannot live on the advisor’s laptop. Clients need to open it from the internet even when the desktop app is closed.
Existing server places the app already reaches:
- Firm backend: `api.lanternplatform.app` in current code, historical `api.keepance.com`. Best candidate.
- License server: `licenses.lanternplatform.app`. Not a good booking host.
- Forms server: `forms.lanternplatform.app`. For telemetry/forms, not booking.
- Marketing website: `advisorprephero.com` / old `keepance.com`. Could host static pages, but needs backend for live slots.
- Provider APIs: Microsoft, Google, Gmail, Calendly. These are external APIs, not app-owned public booking infrastructure.
Core choice:
- Privacy-preserving v1: server hosts public page and stores safe availability snapshots; desktop confirms and creates events when awake.
- True Calendly-style instant booking: server must either hold write-capable calendar tokens or have another always-on worker that can create events. That is a bigger trust change from today’s local-first design.