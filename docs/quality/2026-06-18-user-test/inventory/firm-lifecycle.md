# Firm lifecycle test inventory

Investigation date: 2026-06-18.

Scope: real Advisor Prep Hero Tauri/app user stories for Firm / multi-user operation. The production firm backend resolves to `https://api.keepance.com`; dev builds use `/api/firm`, proxied by Vite to `FIRM_BACKEND_TARGET` or `http://127.0.0.1:5290`.

Important current-state findings:

- The current Firm UI is not in the old Settings Firm category. The real entry point is the Account window, Firm tab: `src/features/account/AccountWindow.tsx` -> `account-window` -> `account-tab-firm` -> `FirmSignIn` and `FirmAdminConsole`.
- Existing firm E2E tests in `tests/e2e/firm-collaboration.spec.ts` and campaign specs still reference `settings-category-firm`; those tests need selector maintenance before they can exercise current UI.
- "Invite by email" is an in-app admin flow, not outbound email delivery. The admin enters an email, Advisor Prep Hero creates or finds a user, adds that user to the matter, and shows a one-time temporary password in the UI. I did not find an email-sending path.
- Live matter notes have a production UI path. Live `.docx` co-editing has transport, CRDT, and `DocxEditor` prop support, but I did not find a production UI path that calls `openCoeditSession` or passes `coedit` into `DocxEditor`.
- Vault unlock/recovery has a production UI path. Vault enable has component/store/command implementation, but I did not find a production-mounted UI entry to `VaultEnableFlow`.

## Shared setup and surfaces

Firm account surface:

- Route/surface: main app -> rail account identity -> `AccountWindow` -> Firm tab.
- Files: `src/features/account/AccountWindow.tsx`, `src/features/firm/FirmSignIn.tsx`, `src/features/firm/FirmAdminConsole.tsx`, `src/platform/hooks/useFirm.ts`, `src/platform/firm/firmStore.ts`.
- Test ids: `account-window`, `account-tab-firm`, `firm-signin`, `firm-signin-form`, `firm-email`, `firm-password`, `firm-signin-submit`, `firm-sso-submit`, `firm-just-bought`, `firm-claim-form`, `firm-claim-license-key`, `firm-claim-email`, `firm-claim-password`, `firm-claim-confirm-password`, `firm-claim-org-name`, `firm-claim-submit`, `firm-claim-success`, `firm-error`, `firm-signout`.

Firm admin surface:

- Route/surface: Account window -> Firm tab -> signed-in admin -> `FirmAdminConsole`.
- File: `src/features/firm/FirmAdminConsole.tsx`.
- Test ids: `firm-admin-console`, `firm-admin-refresh`, `firm-admin-error`, `firm-admin-notice`, `firm-new-matter-name`, `firm-create-matter`, `firm-matter-list`, `firm-matter-{matter_id}`, `firm-member-email`, `firm-add-member`, `firm-republish-keys`, `firm-admin-temp-password`, `firm-copy-temp-password`, `firm-member-list`, `firm-remove-member-{user_id}`, `firm-wall-user-id`, `firm-set-wall`, `firm-wall-list`, `firm-clear-wall-{user_id}`, `firm-seat-list`, `firm-revoke-seat-{seat_id}`, `sso-provider`, `sso-issuer`, `sso-client-id`, `sso-client-secret`, `sso-enabled`, `sso-save`, `sso-delete`, `firm-key-provider`, `firm-key-value`, `firm-set-key`, `firm-managed-key-list`, `firm-delete-key-{provider}`.

Matter manager surface:

- Route/surface: AI Assistant -> chat header matter scope selector -> manage matters dialog.
- Files: `src/features/matters/MatterScopeSelector.tsx`, `src/features/matters/MatterManagerDialog.tsx`, `src/features/matters/MatterNotesEditorWrapper.tsx`, `src/features/matters/MatterNotesEditor.tsx`, `src/features/matters/logic/matterNotesSync.ts`, `src/features/matters/logic/openMatterNotes.ts`.
- Test ids: `matter-scope-selector`, `matter-scope-manage`, `matter-manager-dialog`, `matter-new-name`, `matter-new-client`, `matter-new-privileged`, `matter-create-button`, `firm-shared-mine-section`, `firm-refresh-mine`, `firm-open-error`, `firm-remote-matter-{matter_id}`, `firm-open-remote-{matter_id}`, `matter-row-{localMatterId}`, `firm-section-{localMatterId}`, `firm-share-{localMatterId}`, `firm-share-error`, `matter-firm-shared-badge-{localMatterId}`, `matter-open-notes-{localMatterId}`, `matter-notes-editor`, `matter-notes-no-access`, `matter-notes-sync-badge`, `matter-notes-cm-editor`.

AI privacy / Assured surface:

- Route/surface: Settings -> AI & Privacy -> AI subsection.
- Files: `src/features/settings/SettingsContent.tsx`, `src/features/settings/ConfidentialityModeSettings.tsx`, `src/platform/privacy/egress.ts`, `src/platform/firm/assuredInference.ts`, `src/platform/firm/resolveAssuredRoute.ts`.
- Test ids: `settings-category-ai-privacy`, `subheader-ai-heading`, `confidentiality-mode-settings`, `confidentiality-mode-local-only`, `confidentiality-mode-direct`, `confidentiality-mode-assured`, `egress-indicator`.

Vault surface:

- Unlock/recovery route/surface: workspace picker/open flow in Tauri; if selected workspace has `.keepance-vault.json` and no keychain VMK, show vault prompt.
- Files: `src/features/documents/workspace/WorkspaceSelector.tsx`, `src/features/firm/vault/VaultLockedPrompt.tsx`, `src/features/firm/vault/VaultEscapeHatchDialog.tsx`, `src/platform/firm/vault/vaultClient.ts`, `src/platform/firm/vaultStore.ts`, `src/platform/fs/VaultFSBackend.ts`, `src-tauri/src/commands/vault/mod.rs`.
- Test ids: `recovery-phrase-input`, `vault-unlock-error`, `escape-hatch-confirm`, `escape-hatch-error`.
- Enable flow files exist: `src/features/firm/vault/VaultEnableFlow.tsx`, `src/features/firm/vault/RecoveryPhraseCeremony.tsx`, `src/platform/firm/vaultStore.ts`. I did not find a production-mounted route or test id for opening this flow.

Local real-backend test harness:

- Script: `./scripts/run-firm-backend-local.sh`.
- Starts backend at `127.0.0.1:5290`, uses temp SQLite, bootstraps an org/admin/license, seeds member and walled users, prints `FIRM_E2E_*` exports.
- Vite proxy: `/api/firm` -> `FIRM_BACKEND_TARGET` or `http://127.0.0.1:5290`; WebSocket proxy is enabled.
- Existing command shape: `npx playwright test tests/e2e/firm-collaboration.spec.ts --project=en`.
- Browser contexts can simulate separate users/devices for firm keys and relay sync. Native-only behavior, including OS keychain vault and real SSO loopback command, requires Tauri under a display/virtual display.

## Story 1: LemonSqueezy Firm provisioning

As a firm-admin I want my Firm subscription purchase to provision an unclaimed organization so that I can claim it inside Advisor Prep Hero.

UI steps:

- This story has no in-app UI until claim. Provisioning is a backend webhook story.
- Backend files: `backend/src/routes/webhooks.ts`, `backend/src/routes/claim.ts`, `backend/src/lib/db.ts`.
- Production endpoint: `POST /webhooks/lemonsqueezy`.

Preconditions:

- Firm LemonSqueezy variant configured in backend `FIRM_VARIANT_IDS` or variant name contains `Firm`.
- Backend has `LEMONSQUEEZY_WEBHOOK_SECRET`.
- Webhook event is `subscription_created`.
- Payload includes quantity for seat limit and should include a license key in `meta.custom_data.license_key` for testability.

Expected result:

- Backend verifies `X-Signature` HMAC SHA256.
- Creates org with `status='unclaimed'`, `plan='practice'`, legal pack, and `seat_limit=quantity`.
- Creates license-key hash only. Plaintext key is not stored.
- Duplicate webhook id/subscription id is idempotent.

Backend/state/second-user needed:

- Needs backend database write.
- No second user.
- No concurrent app instances.

Real local test method:

- Run local backend with a temp DB.
- Send a signed synthetic LemonSqueezy `subscription_created` payload to `/webhooks/lemonsqueezy`, with a known `meta.custom_data.license_key`.
- Then use the app claim UI with that key.

Production-only flags:

- A true production test needs either a LemonSqueezy test/sandbox subscription or a signed webhook using the production secret. That mutates production billing/org state and should not be run in read-only investigation.
- If the webhook falls back to a generated license key because the payload lacks a key, there is no app-visible plaintext key to claim.

Recommended changes:

- Add a non-production webhook fixture test that asserts Firm quantity maps to `seat_limit` and the known license can be claimed.
- Keep production smoke tests manual or use a dedicated throwaway LemonSqueezy test product/org.

## Story 2: Organization claim via `/org/claim`

As a firm-admin I want to claim the unclaimed organization from my purchase so that I become the first admin.

UI steps:

- Open Account window -> Firm tab.
- In `FirmSignIn`, click `firm-just-bought`.
- Fill `firm-claim-license-key`, `firm-claim-email`, `firm-claim-password`, `firm-claim-confirm-password`, and optionally `firm-claim-org-name`.
- Click `firm-claim-submit`.

Preconditions:

- Backend has an unclaimed org/license key from LemonSqueezy provisioning or local bootstrap.
- Password is 12-200 characters.
- Email is not already used.

Expected result:

- UI shows `firm-claim-success`, then establishes a firm session.
- Backend `POST /org/claim` atomically marks org claimed, creates admin user, and returns login/session tokens.
- Firm store persists non-secret session in `localStorage` and secrets in OS keychain or fallback.

Backend/state/second-user needed:

- Needs real backend org/license state.
- No second user.
- No concurrent app instances.

Real local test method:

- Use `scripts/run-firm-backend-local.sh`, or signed local LemonSqueezy webhook with known license.
- Navigate to Account -> Firm -> claim form and claim the license.
- Assert `firm-claim-success`, then signed-in display: `firm-email-display`, `firm-org-name`, `firm-seat-status`.

Production-only flags:

- Can be tested against production only with a throwaway real unclaimed org/license. Reusing a production license is destructive because claim is one-time.

Recommended changes:

- Add an E2E claim test using local webhook-created org, separate from the already-seeded bootstrap login path.

## Story 3: Admin sign-in and seat activation

As a firm-admin I want to sign into my firm account and activate this machine so that Firm features and entitlement unlock on this device.

UI steps:

- Open Account window -> Firm tab.
- Fill `firm-email` and `firm-password`.
- Click `firm-signin-submit`.
- If the seat is not active, fill `firm-license-key` and `firm-machine-label`.
- Click `firm-activate-submit`.

Preconditions:

- Admin user exists and org is claimed.
- Valid license key for org, with unused seat capacity.
- Tauri app uses OS keychain for tokens; browser E2E uses fallback storage.

Expected result:

- Session shows `firm-email-display`, `firm-org-name`, role, `firm-seat-id`, and `firm-seat-status`.
- `firm-seat-status` has active subscription state, `data-offline=false`.
- `FirmAdminConsole` renders for admin via `firm-admin-console`.
- Entitlement tier resolves to Firm.

Backend/state/second-user needed:

- Needs `/auth/login`, `/org/activate`, `/seat/validate`, `/seat/heartbeat`.
- No second user.
- No concurrent app instances.

Real local test method:

- Start local backend script.
- Run Vite with `/api/firm` proxy.
- Use Playwright with current Account window selectors, not old `settings-category-firm`.
- Assert seat appears in `firm-seat-list`.

Production-only flags:

- Production activation consumes a real seat. Use a dedicated test org/license if exercising against `api.keepance.com`.

Recommended changes:

- Update `tests/e2e/firm-collaboration.spec.ts` to open Account -> Firm instead of Settings -> Firm.
- Add an assertion that the seat heartbeat/validation path survives reload.

## Story 4: Admin configures SSO (OIDC)

As a firm-admin I want to configure my firm's OIDC provider so that members can sign in with firm identity.

UI steps:

- Open Account window -> Firm tab as admin.
- In `FirmAdminConsole`, find SSO section.
- Copy redirect URI from the read-only `sso-redirect-uri` input. This input currently has no `data-testid`.
- Set `sso-provider`, `sso-issuer`, `sso-client-id`, `sso-client-secret`, and `sso-enabled`.
- Click `sso-save`.
- To remove config, click `sso-delete`.

Preconditions:

- Admin signed in and activated.
- OIDC issuer available. Backend allows HTTPS issuers and loopback issuers for local testing.
- Client secret is required on first setup; blank secret keeps existing secret after setup.

Expected result:

- Backend stores config at `/org/sso/config/set`, encrypting the client secret.
- `/org/sso/config/get` returns config view with `has_secret=true` and no plaintext secret.
- UI clears secret field after save and shows saved-secret hint on reload.

Backend/state/second-user needed:

- Needs backend DB and a real or mock OIDC issuer.
- No second app instance required.

Real local test method:

- Run local backend.
- Run a local mock OIDC issuer with discovery, JWKS, authorization endpoint, and token endpoint.
- Save config with loopback issuer URL.
- Assert `firm-admin-notice`, reload admin console, and assert fields repopulate except secret.

Production-only flags:

- Real Entra/Google tenant setup needs external IdP admin access. Production backend is not inherently required; a local backend can prove the code path with a mock issuer.

Recommended changes:

- Add `data-testid` for redirect URI input/copy button.
- Add a local mock OIDC integration test that proves secret is write-only and config survives refresh.

## Story 5: Member signs in with SSO

As a firm-member I want to sign in with my firm's SSO so that I do not need a Advisor Prep Hero password.

UI steps:

- In Tauri only, open Account window -> Firm tab.
- Enter email in `firm-email`.
- Click `firm-sso-submit`.
- Complete IdP login in the system browser.
- Tauri loopback receives `sso_code`, exchanges it, and returns to signed-in Firm UI.

Preconditions:

- Member user exists and is active in the org.
- Org SSO config is enabled.
- Tauri environment is required because `firm-sso-submit` is hidden outside `isTauri()`.
- Native command `firm_sso_authenticate` must be registered.

Expected result:

- `src-tauri/src/commands/firm/sso.rs` opens the auth URL and waits up to 300 seconds on `127.0.0.1:<ephemeral>`.
- Backend `/auth/sso/start` returns an auth URL, `/auth/sso/callback` redirects to loopback with a short-lived `sso_code`, and `/auth/sso/exchange` returns a login response.
- Firm store establishes a normal session.

Backend/state/second-user needed:

- Needs backend plus OIDC issuer.
- No second app instance.
- Needs system browser and loopback networking.

Real local test method:

- Run Tauri under the Linux headless display setup used for native tests.
- Run local backend and mock OIDC issuer.
- Configure SSO as admin first.
- Start a fresh Tauri profile/session as member and click `firm-sso-submit`.

Production-only flags:

- Full Entra/Google sign-in needs a real tenant and test account. Browser-only Playwright cannot test this because the SSO button does not render outside Tauri.

Recommended changes:

- Add a native integration harness for `firm_sso_authenticate` with a mock OIDC server.
- Keep the browser unit tests for button visibility and command invocation, but do not treat them as end-to-end SSO coverage.

## Story 6: Admin invites a member by email

As a firm-admin I want to invite a member by email to a matter so that they can join the work without knowing internal user ids.

UI steps:

- Open Account -> Firm as admin.
- In admin console, select a matter via `firm-matter-{matter_id}`.
- Enter member email in `firm-member-email`.
- Click `firm-add-member`.
- If the user is new, copy the one-time temporary password from `firm-admin-temp-password` / `firm-copy-temp-password`.

Preconditions:

- Admin signed in and activated.
- Matter exists.
- Email must be in same org or newly creatable.

Expected result:

- If email is cached/existing, backend adds that user to matter.
- If email is new, client generates a 16-character temporary password, calls `/org/users`, then adds that user to matter.
- If key release is allowed, client best-effort publishes the matter key to currently registered recipient devices.
- `firm-member-list` shows the member email.

Backend/state/second-user needed:

- Needs backend org user and matter state.
- No second app instance to create the invite.
- Second app instance is needed later to prove member sign-in/device registration/key receipt.

Real local test method:

- Use local backend script, which seeds member and walled users, or create a new email through this UI.
- Select matter, invite member, assert `firm-admin-notice` and `firm-member-list`.
- For new user, assert `firm-admin-temp-password` appears and use the shown password in a second context.

Production-only flags:

- There is no real outbound email path in this UI. A production test cannot verify email delivery because the app does not send one.

Recommended changes:

- Either rename copy to "Add member" / "Create member" or implement actual transactional invite email delivery.
- Add test coverage for the one-time password display and absence after refresh.

## Story 7: Member joins, activates seat, and registers a device

As a firm-member I want to sign in and activate my device so that I can receive matter keys and open shared matters.

UI steps:

- Open Account -> Firm in a separate app instance/context.
- Sign in with `firm-email`, `firm-password`, `firm-signin-submit`, or use SSO if configured.
- Activate with `firm-license-key`, `firm-machine-label`, `firm-activate-submit` if no active seat.
- Open matter manager and click `firm-refresh-mine`.
- Open a remote matter via `firm-open-remote-{matter_id}`.

Preconditions:

- Member user exists.
- License has available seats.
- Member has been added to a matter.
- For key receipt, member device must register its P-256 public key via `/device/register`.

Expected result:

- Seat becomes active.
- Device registration stores a public EC P-256 JWK only; private key stays local in keychain/fallback.
- If wrapped matter key exists for this device, remote matter opens and links to local matter.
- If no wrapped key exists yet, UI fails closed with `firm-open-error` and message equivalent to `firm-key-blocked`.

Backend/state/second-user needed:

- Needs backend, member account, seat capacity, and at least one matter membership.
- Requires a logically separate device context to prove device registration/key wrapping. Browser contexts are enough for most E2E; Tauri profiles are needed to prove OS keychain behavior.
- Two concurrent instances are not strictly required unless also testing live co-editing.

Real local test method:

- Browser: two Playwright contexts against local backend. Context A admin, context B member.
- Tauri: two separate app profiles/data dirs under virtual display to avoid shared keychain/fallback identity.
- Member first attempts open before admin republishes keys to verify fail-closed, then admin clicks `firm-republish-keys`, member refreshes and opens successfully.

Production-only flags:

- Production test consumes a seat and writes device/key state to `api.keepance.com`.

Recommended changes:

- Add an explicit device-registration assertion to the E2E flow, either through backend test helper or UI-visible pending-key state.

## Story 8: Admin shares a local matter with cross-member key distribution and admin escrow

As a firm-admin I want to share a local matter to my firm so that members get encrypted access and admins retain escrow.

UI steps:

- Open matter manager.
- Create or select local matter.
- Click `firm-share-{localMatterId}`.
- In admin console, select the corresponding `firm-matter-{matter_id}` to manage membership and keys.

Preconditions:

- Admin signed in and activated.
- Local matter exists.
- Admin device has a generated P-256 keypair and a matter content key can be stored locally.
- Target members/admins have registered devices if they should receive wrapped keys immediately.

Expected result:

- Client calls `/org/matters` to create firm matter.
- Local matter links to `firmMatterId`, `orgId`, role owner.
- `getOrCreateMatterKey` creates/stores AES-256 matter key in local keychain/fallback.
- `registerDevice` sends admin public P-256 JWK.
- `publishMatterKeyToMembers` wraps the matter key to eligible member devices and org admin devices. Admin devices are included for escrow.
- UI shows `matter-firm-shared-badge-{localMatterId}`.

Backend/state/second-user needed:

- Backend matter, membership, devices, wrapped key records.
- Second user/device needed to prove cross-member unwrap.
- Two concurrent instances not required for key distribution itself, but useful to catch pending-key timing.

Real local test method:

- Admin context creates local matter and shares it.
- Member context signs in and activates, registers by attempting to open shared matter.
- Admin console remains open or clicks `firm-republish-keys`; auto-republish also polls every 60 seconds while console is open.
- Member opens remote matter successfully after wrapped key is published.

Production-only flags:

- No real second machine is required. Two isolated app profiles or browser contexts are enough to exercise cryptographic wrapping and unwrap, except for proving native OS keychain isolation.

Recommended changes:

- Expose a test-only or admin-visible "keys published to N devices" status to remove timing ambiguity from auto-republish tests.

## Story 9: Member opens shared matter and fails closed without key release

As a firm-member I want access to fail closed when my device has not received a matter key so that membership alone never exposes content.

UI steps:

- Member opens matter manager.
- Click `firm-refresh-mine`.
- Click `firm-open-remote-{matter_id}` for a matter where membership exists but no wrapped key exists for this device.

Preconditions:

- Member belongs to matter.
- Member seat is active.
- Member device key is registered.
- No wrapped key exists for member's device at current epoch.

Expected result:

- Backend `/matter/mine` lists matter because membership exists.
- `/matter/:id/keys/fetch` returns 404 or access-denied key state.
- UI does not create a local matter, sets `firm-open-error`, and tells member it is waiting for the firm admin.

Backend/state/second-user needed:

- Needs backend.
- Needs admin-created matter and member user.
- Two concurrent instances not required, but easiest with admin and member contexts.

Real local test method:

- Admin creates matter and adds member before member has a registered device.
- Member signs in, activates, tries to open, and sees fail-closed error.
- Admin republishes keys, member retries and succeeds.

Production-only flags:

- No production backend or real second machine is strictly required.

Recommended changes:

- Add a stable `data-testid` or `data-code` for the `firm-key-blocked` condition so tests do not depend on copy.

## Story 10: Live collaborative matter notes over E2EE relay

As a firm-member I want matter notes to update live with another user so that both of us work from the same encrypted shared notes.

UI steps:

- Both users open the same linked/shared matter.
- Each clicks `matter-open-notes-{localMatterId}` or opens notes through matter workflow.
- Confirm `matter-notes-editor` and `matter-notes-sync-badge`.
- User A edits in `matter-notes-cm-editor`.
- User B sees the content converge.

Preconditions:

- Both users signed in, activated, and members of same matter.
- Both have current matter key for current epoch.
- Backend relay HTTP pull and WebSocket ticket endpoints available.
- Vite proxy must forward WebSocket upgrades for browser E2E.

Expected result:

- `MatterSyncClient` encrypts each Yjs update using the local matter key and current key epoch.
- Backend stores and fans out opaque `ciphertext_b64`; server never sees plaintext.
- Other client pulls/decrypts/apply updates.
- Notes mirror to local `matter-notes.md`, but Yjs relay is source of truth.

Backend/state/second-user needed:

- Requires two concurrent app instances or browser contexts for a real convergence test.
- Requires backend relay. A stub relay can test client behavior, but not production routing/auth/ticket handling.

Real local test method:

- Fix current E2E selectors to Account -> Firm.
- Run `scripts/run-firm-backend-local.sh`.
- Run Playwright with two browser contexts and `FIRM_E2E_BACKEND_URL`.
- Assert convergence after typing distinct marker text in one context.

Production-only flags:

- Production backend not required.
- Real second machine not required. Two contexts or two Tauri profiles are sufficient.

Recommended changes:

- Keep browser-context E2E for fast relay coverage.
- Add one native two-profile smoke test to prove keychain/fallback and Tauri packaging do not break the same flow.

## Story 11: Live `.docx` co-editing over E2EE relay

As a firm-member I want a Word document in a shared matter to co-edit live so that tracked legal drafting works across users.

UI steps:

- Intended steps would be: open a `.docx` inside a shared matter in two clients, each editor receives a `CoeditSession`, and `DocxEditor` shows `docx-presence-pill` when another editor is present.
- Current production UI path found: `MainPanel` renders `DocxEditor` for `.docx`, but does not pass `coedit`.
- Current co-edit implementation path: `openCoeditSession` -> `MatterDocSyncClient` -> `DocxEditor` optional `coedit` prop.

Preconditions:

- Same as live matter notes, plus a document id for the `.docx` stream and an initial `DocumentJson`.
- Production UI must know the current matter scope and pass a co-edit session to `DocxEditor`.

Expected result:

- `MatterDocSyncClient` uses the same E2EE relay with `doc_id` set to the document id instead of `_notes`.
- `coeditSession` joins existing relay state or seeds initial JSON if empty.
- `DocxEditor` applies remote changes, saves local edits into the CRDT, and shows `docx-presence-pill` when other editors are connected.

Backend/state/second-user needed:

- Requires two concurrent instances/contexts to prove live collaboration.
- Requires backend relay or a high-fidelity stub.

Real local test method:

- Today: unit/integration only, using `tests/unit/coedit/matterDocSync.test.ts`, `tests/unit/coedit/coeditSession.test.ts`, and `tests/unit/coedit/DocxEditor.coedit.test.tsx`.
- End-to-end in real app is blocked until a production UI path opens `CoeditSession` and passes it to `DocxEditor`.

Production-only flags:

- Cannot be tested as a real app user story today without adding/wiring the UI entry. Production backend and a real second machine are not the blockers; missing production UI wiring is.

Recommended changes:

- Wire shared-matter `.docx` open flow to `openCoeditSession`.
- Add route/test ids that identify a document as co-editing, e.g. `docx-coedit-status`.
- Then add a two-context E2E analogous to matter notes.

## Story 12: Ethical wall, key purge, and epoch rotation

As a firm-admin I want to wall a member from a matter so that they lose future access even if they were previously a member.

UI steps:

- Open Account -> Firm as admin.
- Select matter via `firm-matter-{matter_id}`.
- Enter target email in `firm-wall-user-id`.
- Click `firm-set-wall`.
- Observe wall entry in `firm-wall-list`.
- To clear, click `firm-clear-wall-{user_id}`.

Preconditions:

- Admin and target member are in same org.
- Target user exists and email is present in admin cache from `/org/users/list`.
- Matter exists and target is a member or otherwise resolvable.
- To prove purge effect, target should have previously opened the matter and held a key.

Expected result:

- Backend sets wall, removes target's matter membership access, bumps `key_epoch`, deletes wrapped keys for target/walled devices, and deletes old epoch wrapped keys.
- `/matter/mine`, `/keys/fetch`, relay pull, relay push, and sync ticket deny the walled member.
- Existing clients that see newer epoch cannot decrypt new updates; blocked member should fail closed.
- Admin/member key republish after epoch rotation publishes only to eligible non-walled users and admin escrow devices.

Backend/state/second-user needed:

- Needs backend.
- Needs at least admin and walled member.
- Two concurrent instances are strongly recommended: one admin to raise wall, one member already connected to notes to verify live denial/stale-key behavior.

Real local test method:

- Run local backend script; it seeds `walled@keepance-e2e.test`.
- Admin shares matter and invites/opens for walled user.
- Walled user verifies access.
- Admin sets wall.
- Walled user refreshes mine list, tries notes sync or remote open, and should be denied.
- Non-walled member still syncs after admin republishes keys.

Production-only flags:

- No production backend or real second machine required.
- To prove OS keychain key purge, use Tauri profiles rather than browser contexts.

Recommended changes:

- Add an explicit UI/test signal for `key_epoch` advancement and denied relay state.
- Add a native smoke for "previously cached key cannot keep syncing after wall."

## Story 13: Assured zero-retention routing

As a firm-member I want AI requests to route through my firm's zero-retention proxy when Assured mode is selected so that managed provider keys are used without Advisor Prep Hero retaining content.

UI steps:

- Admin opens Account -> Firm -> Assured managed keys.
- Choose `firm-key-provider`, enter `firm-key-value`, click `firm-set-key`.
- Member/admin opens Settings -> AI & Privacy -> AI.
- Select `confidentiality-mode-assured`.
- Trigger an AI call with a supported provider/model.
- Observe `egress-indicator` / settings state showing assured proxy.

Preconditions:

- Firm user signed in and activated.
- Admin has stored a managed provider key for `anthropic`, `openai`, or `google`.
- User selects Assured mode.
- Provider/model is supported by `resolveAssuredRoute`.

Expected result:

- `ConfidentialityModeSettings` shows Assured only for active firm sessions.
- Assured card is disabled until `assuredProviders` includes a provider.
- `assuredInference` sends provider-native body to `/assured/infer` with `Authorization`, `X-Seat-Token`, `X-Provider`, `X-Model`, and `X-Stream`.
- Client strips direct vendor auth for the proxied call.
- Backend authenticates access token and active seat, decrypts managed key transiently, forwards opaque body, streams response, and records metadata-only billing/audit rows.
- Response includes no-retention signal headers.

Backend/state/second-user needed:

- Needs backend, active seat, managed key.
- No second user.
- No concurrent app instances.

Real local test method:

- Use local backend with a fake provider endpoint or configure provider target to a local stub if backend supports it.
- Store a dummy managed key.
- Make an AI request in Assured mode and assert request reaches `/assured/infer`, not direct provider endpoint.
- Unit coverage already proves UI gating and egress label in `tests/unit/privacy/assured-mode.test.tsx`.

Production-only flags:

- End-to-end with `api.keepance.com` and a real provider key will hit an external AI provider and may incur cost. It is not required to prove client routing if a local stub is available.
- Verifying "zero retention" in production is primarily code/audit verification, not a UI-only test.

Recommended changes:

- Add an integration test with a local fake provider target and assert the backend persists only metadata, never prompt/completion bytes.
- Add UI-visible last4/provider refresh assertion after `firm-set-key`.

## Story 14: Encrypted workspace vault enable

As a firm-member I want to enable an encrypted workspace vault so that document contents are encrypted at rest on this machine.

UI steps:

- Intended flow: open vault enable UI, click enable, complete recovery phrase ceremony, optionally confirm firm escrow, wait for encryption, finish.
- Current implementation files: `VaultEnableFlow`, `RecoveryPhraseCeremony`, `vaultStore`, `vaultClient`, Rust `vault_create` and `vault_encrypt_all`.
- I did not find a production-mounted route, menu item, or test id that opens `VaultEnableFlow`.

Preconditions:

- Tauri desktop app; browser cannot run vault commands.
- Workspace selected and writable.
- For firm escrow, admin devices must be known with P-256 public keys.

Expected result:

- `vault_create` writes `.keepance-vault.json`, stores VMK in OS keychain, and returns a one-time BIP39 recovery phrase.
- User confirms phrase in `RecoveryPhraseCeremony`.
- `vault_encrypt_all` encrypts file contents as KPV1 AES-256-GCM files. Names/folders remain visible.
- If firm escrow is enabled, `provisionEscrow` wraps VMK to admin devices and stores only wrapped blobs in vault metadata.
- `BackendFactory` wraps Tauri FS in `VaultFSBackend` for enabled vaults.

Backend/state/second-user needed:

- Solo vault enable needs no backend and no second user.
- Firm escrow needs firm admin device public keys; can be stubbed locally.
- No concurrent instances required.

Real local test method:

- Today as real UI: blocked because enable flow is not mounted.
- Native command-level test: use Tauri command harness or Rust tests to create temp workspace, call `vault_create`, `vault_encrypt_all`, then read/write through `VaultFSBackend`.
- Component test: mount `VaultEnableFlow` with mocked Tauri invokes and verify ceremony phases.

Production-only flags:

- No production backend required.
- Cannot be tested as a real app UI story until a production entry point exists.

Recommended changes:

- Add a reachable vault settings surface with test ids for open, enable, phrase verification inputs, escrow confirm, progress, and done.
- Add one native end-to-end test on a temp workspace that asserts on-disk files are ciphertext and app reads remain transparent.

## Story 15: Encrypted workspace vault unlock / recover

As a firm-member I want to unlock a vaulted workspace with my recovery phrase so that I can recover access on a machine missing the keychain VMK.

UI steps:

- In Tauri, open/select a vaulted workspace.
- `WorkspaceSelector` detects `vaultStatus(...).enabled && locked`.
- Enter phrase in `recovery-phrase-input`.
- Click Unlock.
- If needed, use escape hatch and confirm with `escape-hatch-confirm`.

Preconditions:

- Workspace has `.keepance-vault.json`.
- VMK is absent from OS keychain on this machine/profile.
- User has the correct 24-word recovery phrase.

Expected result:

- Correct phrase calls `vault_unlock_with_recovery`, restores VMK to keychain, and opens workspace.
- Wrong phrase renders `vault-unlock-error`, with specific handling for invalid format vs phrase does not match this vault.
- Escape hatch calls `vault_decrypt_all` then `vault_disable`; `vault_disable` must not run if decrypt fails.

Backend/state/second-user needed:

- No backend for recovery phrase path.
- No second user.
- No concurrent app instances.
- Firm admin escrow recovery is not surfaced as a UI path in the files inspected.

Real local test method:

- Use Tauri/native command harness on a temp workspace.
- Create vault and phrase, remove keychain VMK or run under a fresh profile, open workspace, enter phrase, assert normal file access.
- Unit coverage already exists for prompt and escape hatch behavior.

Production-only flags:

- No production backend or real second machine required. A fresh OS user/profile or cleared keychain entry simulates second machine sufficiently.

Recommended changes:

- Add stable test ids for unlock and escape-hatch buttons, not only input/error/confirm.
- Add a native temp-workspace recovery test.

## Story 16: Seat revocation and deprovisioning follow-on

As a firm-admin I want to revoke a seat or remove a user so that lost devices stop accessing firm resources.

UI steps:

- Open Account -> Firm as admin.
- Use `firm-seat-list`.
- Click `firm-revoke-seat-{seat_id}` for active seat.
- For matter-level removal, select matter and click `firm-remove-member-{user_id}`.

Preconditions:

- Admin signed in and activated.
- Target user has active seat or matter membership.

Expected result:

- Seat revocation calls `/org/seat/revoke`, audit logs `seat_revoked`, and future seat validation/relay/Assured calls with that seat token fail.
- Matter removal bumps epoch and removes access like an ethical wall for that matter.
- `FirmAdminConsole` reloads seats/members.

Backend/state/second-user needed:

- Needs backend.
- Second context recommended to prove the revoked user can no longer use old seat token.
- Concurrent instances useful but not mandatory.

Real local test method:

- Admin and member contexts.
- Member opens notes or uses `/matter/mine`.
- Admin revokes member seat.
- Member retries refresh/sync/Assured call and receives denial.

Production-only flags:

- Production test mutates real seat/user state. Use test org only.

Recommended changes:

- Add a full denial-after-seat-revoke E2E that checks `/matter/mine`, sync ticket, and Assured proxy all reject the stale seat token.

## Test matrix summary

Can be tested locally with local backend and two browser contexts:

- Password sign-in and seat activation.
- Invite/add member, including temporary password display.
- Shared matter creation, key publish, member device registration using fallback storage.
- Pending-key fail-closed behavior.
- Matter notes E2EE relay convergence.
- Ethical wall membership denial and epoch bump at HTTP/UI level.

Needs Tauri/native harness:

- SSO sign-in button and `firm_sso_authenticate` loopback/system-browser flow.
- OS keychain storage for firm tokens, device keys, matter keys, and vault VMK.
- Vault enable, unlock/recover, transparent file encryption.
- Stronger proof that two profiles/devices do not share key material.

Needs production backend or real external service:

- Real LemonSqueezy purchase/webhook provisioning in production.
- Real Entra/Google tenant SSO.
- Real Assured proxy call through `api.keepance.com` to an upstream provider.

Does not need a real second physical machine:

- Most multi-user flows can run with two isolated browser contexts or two Tauri profiles on this Linux box.
- A real second machine is only useful for final confidence around OS keychain isolation and desktop/browser SSO ergonomics.

Currently blocked as real app UI stories:

- `.docx` co-editing, until `openCoeditSession` is wired into the production document-open path.
- Vault enable, until `VaultEnableFlow` is mounted in a reachable production surface.
- Outbound invite email, because current code creates/attaches users and shows a temp password but does not send email.

Recommended near-term test work:

1. Update existing firm E2E navigation from old Settings Firm selector to Account window -> Firm tab.
2. Split local firm lifecycle E2E into seeded admin/member setup, pending-key fail-closed, key republish success, notes convergence, and ethical-wall denial.
3. Add a native Tauri harness for SSO loopback and vault recovery.
4. Wire and test `.docx` co-editing only after the production UI passes `coedit` into `DocxEditor`.
5. Add a mounted vault enable surface before claiming vault enable is covered by real user tests.
