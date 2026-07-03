# Vendor-Credential Applications Checklist (Wave 0 paperwork track)

These are HUMAN/PAPERWORK tasks, not code tasks. They run in parallel with all
engineering waves (calendar time, not build time). File all three NOW.

All three connectors are already built: CONNECTORS.md lists them under
"Code-complete, gated on vendor credentials" (docs/reference/CONNECTORS.md:190).
The code compiles, is registered, and has UI; each needs exactly one vendor
credential injected via an env var at build time to go live.

Shared facts for every application:
- Applicant / legal entity: Jameson S Daines (sole proprietor, no LLC/DBA).
- Contact email for vendor correspondence: developers@keepance.com
  (replies via the keepance-send CLI; it BCCs Jameson).
- Product name on applications: confirm with Jameson which brand to use
  (JAMESON DECISION - the advisorprephero.com rebrand means the
  customer-facing brand may differ from "Keepance"; pick ONE and use it on
  all three applications).
- Product description to paste: "Desktop application for financial advisors.
  Local-first: reads CRM/e-signature data into an on-device, encrypted
  workspace. Read-only API access. No customer data is stored on our
  servers (we have none)."

---

## 1. Redtail CRM - partner API key

- Status in code: COMPLETE, gated. Provider at
  src-tauri/src/commands/crm/redtail.rs (registered via
  src-tauri/src/commands/crm/provider.rs), UI at
  src/platform/connectors/crm/RedtailConnect.tsx.
- Credential the code reads: env var `KEEPANCE_REDTAIL_API_KEY`
  (redtail.rs:427-430, verified). The advisor supplies their own Redtail
  username+password at runtime; our vendor key + their login form the Basic
  auth header, exchanged for a per-user UserKey.
- Where to apply: Redtail's developer/API program -
  https://developers.redtailtechnology.com (VERIFY-LIVE: current URL), or
  email their API team at api@redtailtechnology.com (VERIFY-LIVE: current
  address - Redtail historically issues vendor API keys by emailed request).
- What the application asks for (typical; VERIFY-LIVE on the form):
  company/developer name, contact email, product description, intended API
  usage (read-only: contacts, notes, activities), expected call volume.
- NEEDS JAMESON: signing any API/partner agreement; final brand-name choice.
- On receipt: store the key in the CI secret KEEPANCE_REDTAIL_API_KEY
  (mirrors the existing KEEPANCE_MS_CLIENT_ID pattern in
  .github/workflows/release.yml), never in source. Then run the connector's
  live-vendor validation before announcing it (real APIs always surprise).

## 2. Salesforce - connected app (consumer key)

- Status in code: COMPLETE, gated. Provider at
  src-tauri/src/commands/crm/salesforce.rs (registered via provider.rs),
  UI at src/platform/connectors/crm/SalesforceConnect.tsx. CONNECTORS.md
  caveat: "auto-sync not fully wired."
- Credential the code reads: env var `KEEPANCE_SALESFORCE_CLIENT_ID`
  (salesforce.rs:44-48, verified). PUBLIC OAuth client - no client secret
  (verified: salesforce.rs test `salesforce_auth_url_uses_pkce_and_read_refresh_scopes`
  asserts no client_secret in the auth URL).
- Where to apply: no partner program needed for the key itself. Create a
  free Salesforce Developer Edition org at
  https://developer.salesforce.com/signup (VERIFY-LIVE), then in Setup >
  App Manager create a Connected App with OAuth enabled; the Consumer Key
  is the client id. AppExchange listing / ISV partnership
  (https://partners.salesforce.com, VERIFY-LIVE) is only needed later for
  marketplace distribution - do NOT block on it.
- What the connected-app form needs: app name, contact email, OAuth
  callback URL (`build_salesforce_auth_url`'s `redirect_uri` parameter in
  src-tauri/src/commands/crm/salesforce.rs - it is passed in at call time,
  not a hardcoded constant; read the caller to get the exact value before
  filling this in), OAuth scopes (api, refresh_token, offline_access).
- NEEDS JAMESON: creating the Salesforce account in his name (signup +
  possible phone verification); accepting Salesforce's terms.
- On receipt: CI secret KEEPANCE_SALESFORCE_CLIENT_ID; live validation pass.

## 3. DocuSign - integrator key (app client id)

- Status in code: COMPLETE, gated. Full backend folder
  src-tauri/src/commands/docusign/ with 8 commands registered
  (src-tauri/src/lib.rs, verified: docusign_set_workspace,
  docusign_connect, docusign_is_connected, docusign_disconnect,
  docusign_sync, docusign_cancel_sync, docusign_sync_status,
  docusign_list_unassigned), UI at
  src/platform/connectors/docusign/DocuSignConnect.tsx.
- Credential the code reads: env var `KEEPANCE_DOCUSIGN_CLIENT_ID`
  (docusign/oauth.rs:137, verified; unset builds fall back to a
  non-functional placeholder, `DEFAULT_DEMO_CLIENT_ID`). PKCE OAuth - no
  client secret. The code has a demo vs production environment toggle
  (DocusignEnvironment).
- Where to apply: https://developers.docusign.com (VERIFY-LIVE) - create a
  free developer account, then Apps and Keys > Add App to get an
  integration key immediately (works against the demo environment).
  Production use requires DocuSign's Go-Live review: the app must complete
  20 successful API calls in demo, then pass their review (VERIFY-LIVE:
  current Go-Live requirements).
- What the app registration needs: app name, redirect URI (`build_auth_url`'s
  `redirect_uri` parameter in src-tauri/src/commands/docusign/oauth.rs - it
  is passed in at call time, not a hardcoded constant; read the caller to
  get the exact value before filling this in), PKCE grant type.
- NEEDS JAMESON: creating the DocuSign developer account; the Go-Live
  submission is done under his account.
- On receipt: CI secret KEEPANCE_DOCUSIGN_CLIENT_ID for demo immediately;
  schedule the 20-call Go-Live exercise (can be scripted against the demo
  env) before any customer-facing use.

---

## Contrast case (no application needed)

Wealthbox is live today with NO vendor credential: the advisor pastes their
own API token (src-tauri/src/commands/crm/provider.rs, keychain service
keepance-crm-wealthbox). Nothing to file.

## Tracking

| Vendor | Applied (date) | Credential received | CI secret set | Live validation |
|---|---|---|---|---|
| Redtail | | | | |
| Salesforce | | | | |
| DocuSign | | | | |

Update this table as each step completes; note blockers inline.
