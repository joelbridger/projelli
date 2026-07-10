# Advisor Prep Hero Network Requirements

This page lists the domains, ports, and network behavior visible in the current code. Core document work is local. Network access is used for license checks, updates, optional cloud AI, optional firm features, support forms, and optional connectors.

## Core Runtime Endpoints

| Endpoint | Port | Required? | When used | Source |
|---|---:|---|---|---|
| `https://licenses.lanternplatform.app` | 443 | Required for paid activation and validation | License activation and license checks | [brand.ts](../../../src/config/brand.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `https://api.anthropic.com` | 443 | Optional | Anthropic cloud AI with the user's key | [fetchUtils.ts](../../../src/platform/providers/fetchUtils.ts), [ClaudeProvider.ts](../../../src/platform/providers/ClaudeProvider.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `https://api.openai.com` | 443 | Optional | OpenAI cloud AI with the user's key | [fetchUtils.ts](../../../src/platform/providers/fetchUtils.ts), [OpenAIProvider.ts](../../../src/platform/providers/OpenAIProvider.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `https://generativelanguage.googleapis.com` | 443 | Optional | Google Gemini cloud AI with the user's key | [fetchUtils.ts](../../../src/platform/providers/fetchUtils.ts), [GeminiProvider.ts](../../../src/platform/providers/GeminiProvider.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `https://api.lanternplatform.app` | 443 | Optional for solo, required for firm features | Firm login, seat checks, Firm Assured AI, firm relay HTTP calls | [brand.ts](../../../src/config/brand.ts), [firmConfig.ts](../../../src/platform/firm/firmConfig.ts), [FirmApiClient.ts](../../../src/platform/firm/FirmApiClient.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `wss://api.lanternplatform.app` | 443 | Optional for solo, required for firm live sync | Firm shared workspace live sync and co-editing | [tauri.conf.json](../../../src-tauri/tauri.conf.json), [firmConfig.ts](../../../src/platform/firm/firmConfig.ts), [MatterSyncClient.ts](../../../src/platform/firm/MatterSyncClient.ts) |
| `https://forms.lanternplatform.app/api/forms/*` | 443 | Optional | Bug reports, AI setup help, app events, diagnostics | [brand.ts](../../../src/config/brand.ts), [default.json](../../../src-tauri/capabilities/default.json) |
| `https://github.com/lanternplatform/lantern/releases/latest/download/latest.json` | 443 | Recommended | Auto-update metadata check | [tauri.conf.json](../../../src-tauri/tauri.conf.json) |
| `http://127.0.0.1:11434` | Local loopback | Optional | Local Ollama model discovery and generation | [OllamaProvider.ts](../../../src/platform/providers/OllamaProvider.ts), [tauri.conf.json](../../../src-tauri/tauri.conf.json) |
| `http://127.0.0.1:18089` | Local loopback | Optional | Built-in local AI sidecar | [AppLocalProvider.ts](../../../src/platform/providers/AppLocalProvider.ts), [tauri.conf.json](../../../src-tauri/tauri.conf.json) |

The app's production content security policy and Tauri HTTP permission list are the main source of truth for core runtime endpoints. Source: [tauri.conf.json](../../../src-tauri/tauri.conf.json), [default.json](../../../src-tauri/capabilities/default.json).

## Development-Only Endpoints

These are for local development and automated testing, not normal advisor production use:

| Endpoint | Port | Use | Source |
|---|---:|---|---|
| `http://localhost:5173` | 5173 | Vite development server | [vite.config.ts](../../../vite.config.ts), [tauri.conf.json](../../../src-tauri/tauri.conf.json) |
| `http://127.0.0.1:5290` | 5290 | Default local firm backend target for development proxy | [vite.config.ts](../../../vite.config.ts), [vite.config.e2e.ts](../../../vite.config.e2e.ts) |
| `/api/anthropic`, `/api/openai`, `/api/google`, `/api/firm` | Local dev server | Development proxy paths | [vite.config.ts](../../../vite.config.ts), [vite.config.e2e.ts](../../../vite.config.e2e.ts) |

## Optional Connector Endpoints

Only approve the connector endpoints the firm plans to use.

| Connector | Endpoint or host pattern | Port | When used | Source |
|---|---|---:|---|---|
| Microsoft Outlook, OneDrive, Calendar | `https://login.microsoftonline.com`, `https://graph.microsoft.com` | 443 | Microsoft OAuth and Microsoft Graph API calls | [mail oauth.rs](../../../src-tauri/src/commands/mail/oauth.rs), [mail graph.rs](../../../src-tauri/src/commands/mail/graph.rs), [calendar oauth.rs](../../../src-tauri/src/commands/calendar/oauth.rs), [calendar graph_source.rs](../../../src-tauri/src/commands/calendar/graph_source.rs), [onedrive oauth.rs](../../../src-tauri/src/commands/onedrive/oauth.rs) |
| Google Gmail, Google Calendar | `https://accounts.google.com`, `https://oauth2.googleapis.com`, `https://gmail.googleapis.com`, `https://www.googleapis.com/calendar/v3` | 443 | Google OAuth, Gmail API, Google Calendar API | [gmail oauth.rs](../../../src-tauri/src/commands/mail/gmail/oauth.rs), [gmail api.rs](../../../src-tauri/src/commands/mail/gmail/api.rs), [calendar oauth.rs](../../../src-tauri/src/commands/calendar/oauth.rs), [calendar google_source.rs](../../../src-tauri/src/commands/calendar/google_source.rs) |
| Generic IMAP mail | Firm configured mail host | Usually 993 | Secure IMAP mail import | [imap client.rs](../../../src-tauri/src/commands/mail/imap/client.rs) |
| Generic SMTP mail | Firm configured mail host | Usually 465 or 587 | Sending through the firm's configured mail server, if enabled | [imap send.rs](../../../src-tauri/src/commands/mail/imap/send.rs) |
| Wealthbox | `https://api.crmworkspace.com/v1` | 443 | Wealthbox CRM connector | [crm client.rs](../../../src-tauri/src/commands/crm/client.rs) |
| Salesforce | `https://login.salesforce.com`, then the Salesforce instance URL | 443 | Salesforce OAuth and API calls | [salesforce.rs](../../../src-tauri/src/commands/crm/salesforce.rs) |
| Redtail | `https://api2.redtailtechnology.com/crm/v1/rest` | 443 | Redtail CRM connector | [redtail.rs](../../../src-tauri/src/commands/crm/redtail.rs) |
| DocuSign | `https://account.docusign.com`, `https://account-d.docusign.com`, and DocuSign API base such as `https://na4.docusign.net` | 443 | DocuSign auth and read-only API calls | [docusign model.rs](../../../src-tauri/src/commands/docusign/model.rs), [docusign client.rs](../../../src-tauri/src/commands/docusign/client.rs) |
| Box | `https://api.box.com/2.0` | 443 | Box connector | [box client.rs](../../../src-tauri/src/commands/boxc/client.rs) |
| ShareFile | `https://<subdomain>.sf-api.com/sf/v3` | 443 | ShareFile connector | [sharefile client.rs](../../../src-tauri/src/commands/sharefile/client.rs) |
| Jotform | `https://api.jotform.com` | 443 | Jotform connector | [jotform client.rs](../../../src-tauri/src/commands/jotform/client.rs) |
| Zocks | `https://api.zocks.io/v1` | 443 | Zocks connector. Code notes this vendor base should be confirmed with vendor docs before broad approval. | [zocks client.rs](../../../src-tauri/src/commands/zocks/client.rs) |
| Addepar | `https://<subdomain>.addepar.com/api/v1` | 443 | Addepar connector | [addepar client.rs](../../../src-tauri/src/commands/addepar/client.rs) |
| Calendly | `https://api.calendly.com` | 443 | Calendly connector | [calendly client.rs](../../../src-tauri/src/commands/calendly/client.rs) |
| Calendar ICS feeds | User-entered HTTPS URL | 443 | Calendar feed import | [calendar ics_source.rs](../../../src-tauri/src/commands/calendar/ics_source.rs) |

## VPN Compatibility Statement

Advisor Prep Hero should work behind Perimeter-style VPNs and similar managed networks when outbound HTTPS traffic to the approved domains is allowed.

What the app needs:

- Outbound HTTPS on port 443 for approved cloud services.
- Outbound secure WebSocket on port 443 to `api.lanternplatform.app` if firm live sync or co-editing is used.
- Local loopback access to `127.0.0.1` for local AI and OAuth callback flows.
- No inbound internet connection to the advisor laptop for normal app use.

If the VPN or endpoint protection blocks WebSockets, firm live sync and co-editing may not work. Solo local document work and Local-only AI can still work without that WebSocket path.

If the VPN or proxy blocks local loopback, OAuth connector sign-in and local AI integrations may fail. Local loopback is not an internet exposure. It is traffic inside the same computer.

## Proxy And TLS Inspection Notes

The inspected code does not show an app-specific proxy settings screen. The app uses Tauri native HTTP, the system WebView, and network libraries for outbound calls. In practice, proxy behavior depends on the operating system, the WebView, and the runtime libraries.

Corporate TLS inspection can affect direct AI provider calls, OAuth sign-in, update checks, and firm API calls. If inspection is used, IT should test these paths and either install the corporate root certificate where the runtime can use it or exempt the approved domains.

For cloud AI, do not rewrite destinations in a way that hides where prompt content is going. The app's egress indicator is based on the selected provider and confidentiality mode.

## Minimal Pilot Allowlist

For the narrowest Local-only pilot:

1. `licenses.lanternplatform.app` on 443 for license activation and validation.
2. `github.com` on 443 for app update checks, if auto-update is allowed.
3. `forms.lanternplatform.app` on 443 only if support forms or diagnostics are approved.
4. Local loopback `127.0.0.1:18089` and optionally `127.0.0.1:11434` for local AI.

For BYOK cloud AI, add the selected provider only:

- Anthropic: `api.anthropic.com` on 443.
- OpenAI: `api.openai.com` on 443.
- Google Gemini: `generativelanguage.googleapis.com` on 443.

For firm features, add:

- `api.lanternplatform.app` on HTTPS 443.
- `api.lanternplatform.app` on WSS 443.
