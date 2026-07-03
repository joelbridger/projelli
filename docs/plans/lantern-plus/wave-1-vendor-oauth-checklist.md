# Wave 1 vendor OAuth checklist

## Google: add `calendar.readonly` to the existing Gmail OAuth client

Client: the existing desktop OAuth client behind `KEEPANCE_GMAIL_CLIENT_ID` /
`KEEPANCE_GMAIL_CLIENT_SECRET` (build-time env, see
`src-tauri/src/commands/mail/mod.rs:37-48`). Same client, one new scope.

Steps (Google Cloud Console -> APIs & Services):
1. [ ] Enable the Google Calendar API on the project (Library -> "Google Calendar API" -> Enable).
2. [ ] OAuth consent screen -> Edit app -> Scopes -> add
       `https://www.googleapis.com/auth/calendar.readonly`.
3. [ ] Scope justification text (paste into the form):
       "Lantern is a desktop app for financial advisors. It reads the
       advisor's own calendar events (read-only) to show today's client
       meetings inside the app and prepare a private pre-meeting summary on
       the advisor's machine. Event data is stored encrypted on the user's
       device and never sent to our servers; we have no servers that receive
       user content."
4. [ ] Demo video: screen recording of the desktop consent flow + the
       Today's meetings strip (record after Task 13 lands; verification can
       be submitted with the video to follow if the form allows a draft).
5. [ ] SUBMIT for verification. GATED ON JAMESON: adding a scope to the
       production consent screen re-triggers review for the already-live
       Gmail scopes, which can show existing Gmail users a warning screen
       while under review. Do everything up to submission, then
       notify-jameson NEED YOU with the tradeoff and wait for his go.
6. [ ] While verification is pending, the app works for test users listed on
       the consent screen (add the dev/test Google accounts there now).

## Microsoft: add `Calendars.Read` delegated permission

Client: the existing public app behind `KEEPANCE_MS_CLIENT_ID`
(`src-tauri/src/commands/onedrive/commands.rs:55-59`).
1. [ ] Azure Portal -> App registrations -> the Lantern app -> API permissions
       -> Add -> Microsoft Graph -> Delegated -> `Calendars.Read`.
2. [ ] No admin-consent or Microsoft review is required for this delegated
       scope on personal + most work accounts; users consent at sign-in.
       (VERIFY-LIVE: org-restricted tenants may require admin consent.)
No Jameson gate needed for the Azure side; it does not affect existing users.

## ICS: no vendor step. Zero-OAuth fallback, ships with the code.

Status log:
- 2026-07-02: file created; nothing submitted yet.
- 2026-07-02: worker session (lp/wave-1, calendar backend lane) wrote this
  checklist per Task 1 Step 2. Console clicks (Azure API-permission add,
  Google consent-screen scope add, verification submission) and the
  Jameson go/wait decision are NOT done by this session — flagged in the
  handoff for Jameson to action directly.
