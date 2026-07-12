# Lantern Intake - Wave 1 Bench Verification Runbook

This is the script the coordinator runs after all five Wave 1 lanes are merged to
`lp/intake` and the Wave 1 worker gate has printed `WORKER-DONE: lp/intake`.

The goal is simple: prove the real Windows app can send one intake link, a
phone-sized browser can complete the five locked items, the desktop app decrypts
and files the result, and the relay still cannot read the client's information.

## 0. Hard Stops

Stop before touching the Legion if any of these are true:

- `npm run gate` is not green on `lp/intake`.
- `cd backend && bun test` is not green.
- `cd intake-page && npm test` is not green.
- `npm run intake:headers:test`, `npm run intake:integrity:test`, or
  `npm run intake:fragment-check` is not green.
- `intake-page/`, `infra/intake/`, `src/features/intake/`,
  `src/platform/intake/IntakeSyncClient.ts`, `src/platform/intake/intakeStore.ts`,
  `src/platform/intake/factsStore.ts`, and `src-tauri/src/commands/intake/`
  are missing after the merge.
- The final staging page is not same-origin for the client browser:
  `https://intake-staging.lanternplatform.app` must serve the page and proxy
  `/intake/*` to the relay. Lane C uses relative `/intake/...` URLs. If the old
  two-origin setup survived, the page can render but uploads will fail.
- The staging page CSP allows any third-party origin. It should be `connect-src`
  for same-origin only, either `'self'` or exactly
  `https://intake-staging.lanternplatform.app` after the C/E reconciliation.
- The client link fragment appears anywhere in a server log. The secret is after
  `#`, and browsers must never send it to a server.

Do not use `scripts/desktop-drive.mjs` or the old WebView2 CDP path on this
Legion. Current bench docs say WebView2 remote debugging on `9223` is dead here.
Use the app's dev bridge on `9250` first, and the PyAutoGUI screen agent on
`8765` for browser windows, native dialogs, and screenshots.

## 1. Variables

Run these from the server:

```bash
export SRC=/home/jameson/lp-intake
export LEGION=james@100.127.67.22
export STAMP=$(date -u +%Y%m%dT%H%M%SZ)
export EVIDENCE=/tmp/w1-bench-$STAMP
export PAGE_ORIGIN=https://intake-staging.lanternplatform.app
export RELAY_DB=/home/jameson/services/lantern-intake-staging/data/keepance-firm.sqlite
mkdir -p "$EVIDENCE"
cd "$SRC"
```

Expected:

```bash
git rev-parse --abbrev-ref HEAD
# lp/intake

git status --short
# no output
```

## 2. Preflight Gates

Run the proof commands again in the final merged tree. Save the tails in the
evidence folder.

```bash
npm run gate 2>&1 | tee "$EVIDENCE/gate.log"
(cd backend && bun test) 2>&1 | tee "$EVIDENCE/backend-bun-test.log"
(cd intake-page && npm test) 2>&1 | tee "$EVIDENCE/intake-page-playwright.log"
npm run intake:headers:test 2>&1 | tee "$EVIDENCE/intake-headers-test.log"
npm run intake:integrity:test 2>&1 | tee "$EVIDENCE/intake-integrity-test.log"
npm run intake:fragment-check 2>&1 | tee "$EVIDENCE/intake-fragment-check.log"
npm run intake:deploy:staging:dry-run 2>&1 | tee "$EVIDENCE/intake-staging-dry-run.log"
```

Pass means:

- Gate, backend tests, and page tests finish green.
- The dry run prints a bundle version and bundle hash.
- The fragment check says the HTTP server captured only a path, never a `#...`
  fragment.

## 3. Deploy The Desktop App To The Legion

This uses the real Legion launcher pattern. `C:\keepance` is a synced folder, not
a git repo, so do not run `git pull` on Windows.

```bash
cd "$SRC"
tar czf /tmp/legion-deploy.tgz \
  --exclude='src-tauri/target' \
  --exclude='src-tauri/gen' \
  --exclude='src-tauri/binaries' \
  src src-tauri

scp /tmp/legion-deploy.tgz "$LEGION":C:/deploy.tgz
ssh "$LEGION" "cd C:\keepance; tar -xzf C:\deploy.tgz; Remove-Item C:\deploy.tgz"
ssh "$LEGION" "Stop-ScheduledTask -TaskName KeepanceDev; Start-ScheduledTask -TaskName KeepanceDev"
```

Check the newest log and the two bench control ports:

```bash
ssh "$LEGION" "Get-ChildItem C:\dev-logs -Filter 'dev-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 120" \
  | tee "$EVIDENCE/legion-dev-log-tail.txt"

ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/health').Content" \
  | tee "$EVIDENCE/legion-bridge-health.json"

ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/health').Content" \
  | tee "$EVIDENCE/legion-agent-health.json"
```

Pass means:

- The dev log reaches the normal Tauri dev ready state.
- The bridge returns `{"ok":true,"port":9250}`.
- The screen agent returns `ok`.

## 4. Deploy The Staged Relay And Page

The relay is Bun on loopback. The page is a static bundle with a signed manifest
and a deploy-time byte check. Production is not part of this runbook.

### 4.1 Start Or Restart The Staging Relay

The Caddy staging snippet points the relay at loopback port `5195`.

One-time staging env setup, if `/etc/lantern-intake-staging.env` does not exist:

```bash
sudo -u jameson mkdir -p /home/jameson/services/lantern-intake-staging/data
tmpenv=$(mktemp)
cat > "$tmpenv" <<EOF
HOST=127.0.0.1
PORT=5195
DB_PATH=/home/jameson/services/lantern-intake-staging/data/keepance-firm.sqlite
AUTH_SECRET=$(openssl rand -hex 48)
MANAGED_KEY_SECRET=$(openssl rand -hex 48)
$(cd "$SRC/backend" && /home/jameson/.bun/bin/bun run keygen | tr -d '\r')
EOF
sudo install -o root -g jameson -m 640 "$tmpenv" /etc/lantern-intake-staging.env
shred -u "$tmpenv"
```

Start the relay in a named tmux session so it survives the SSH command:

```bash
tmux kill-session -t intake-relay-staging 2>/dev/null || true
tmux new-session -d -s intake-relay-staging \
  "cd '$SRC/backend' && set -a && . /etc/lantern-intake-staging.env && set +a && /home/jameson/.bun/bin/bun run src/server.ts"

sleep 2
curl -s http://127.0.0.1:5195/healthz | tee "$EVIDENCE/intake-relay-healthz.json"
```

Pass means the health body is:

```json
{"ok":true,"service":"keepance-firm-backend","version":"0.1.0"}
```

### 4.2 Install The Staging Caddy And Tunnel Routes

Only do this if the snippets are not already installed. Back up before editing.

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-w1bench-$STAMP
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-w1bench-$STAMP
```

Install the final same-origin shape inside the existing `:8080 { ... }` Caddy
site block:

```caddy
    @intake_staging host intake-staging.lanternplatform.app
    handle @intake_staging {
        handle /intake/* {
            reverse_proxy 127.0.0.1:5195
        }

        handle_path /_releases/* {
            root * /var/www/lantern-intake-staging/releases
            file_server
        }

        root * /var/www/lantern-intake-staging/current
        try_files {path} /index.html
        file_server

        header {
            Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src https://intake-staging.lanternplatform.app; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'self'; manifest-src 'self'"
            Referrer-Policy "no-referrer"
            X-Content-Type-Options "nosniff"
            X-Frame-Options "DENY"
            Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), display-capture=(), document-domain=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), usb=(), xr-spatial-tracking=()"
            Cross-Origin-Opener-Policy "same-origin"
            Cross-Origin-Resource-Policy "same-origin"
            Cache-Control "no-store"
        }
    }
```

Add the Cloudflare tunnel entry above the final 404 catch-all:

```yaml
  - hostname: intake-staging.lanternplatform.app
    service: http://localhost:8080
```

Then validate and reload:

```bash
sudo mkdir -p /var/www/lantern-intake-staging/releases
sudo chown -R jameson:www-data /var/www/lantern-intake-staging
sudo chmod -R g+rwX /var/www/lantern-intake-staging
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo cloudflared tunnel route dns d4e16129-ddc2-4189-be59-009ebc3f7f6d intake-staging.lanternplatform.app
sudo systemctl restart cloudflared
systemctl status cloudflared --no-pager | tee "$EVIDENCE/cloudflared-status.txt"
```

### 4.3 Publish The Staging Page

Use the Lane E deploy script. Force the relay origin to the same public origin so
the built page and the CSP match the final C/E reconciliation.

```bash
export INTAKE_STAGING_RELAY_ORIGIN=https://intake-staging.lanternplatform.app
export INTAKE_STAGING_BASE_URL=https://intake-staging.lanternplatform.app
export INTAKE_STAGING_WEB_ROOT=/var/www/lantern-intake-staging
export INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PATH=/etc/lantern-intake/manifest-signing-private.pem
export INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PATH=/etc/lantern-intake/manifest-signing-public.pem

npm run intake:deploy:staging 2>&1 | tee "$EVIDENCE/intake-deploy-staging.log"
```

Pass means:

- The command prints `mode: "staging"` and `published: true`.
- It prints a `version`, `bundleHash`, and `checkedAssets`.
- It exits zero. A served-byte mismatch must exit non-zero, not warn.

Final public checks:

```bash
curl -sI "$PAGE_ORIGIN/" | tee "$EVIDENCE/intake-page-headers.txt"
curl -s -o "$EVIDENCE/intake-relay-410-body.json" -w "%{http_code}\n" \
  "$PAGE_ORIGIN/intake/no-such-intake/bundle" \
  | tee "$EVIDENCE/intake-relay-410-status.txt"
```

Pass means:

- Headers contain `Content-Security-Policy`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.
- CSP does not contain any origin except the page's own origin, and no CDN,
  analytics, font, or tag-manager host.
- The relay probe status is `410` and the body is the neutral
  `{"error":"intake_unavailable"}` shape.

## 5. Create The Bench Intake In The Desktop App

Use the `9250` app bridge for precise app actions. Use `/testids` first, then
click and fill by `data-testid`.

```bash
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/testids').Content" \
  | tee "$EVIDENCE/app-testids-before-intake.json"
```

The merged Lane D UI must expose test IDs for these actions. If any are missing,
stop and add them before benching, because this flow needs repeatable proof:

- `new-client-dialog`
- `new-client-open`
- `new-client-name`
- `new-client-create`
- `intake-template-new-household`
- `intake-send-link`
- `intake-copy-link`
- `onboarding-tab`
- `onboarding-checklist`
- `onboarding-sync-now`
- `onboarding-files-list`
- `onboarding-facts-list`
- `onboarding-activity-trail`
- `onboarding-regenerate-link`

Create a new fixture client:

```bash
CLIENT_NAME="W1 Bench Sarah Plainclient $STAMP"
export CLIENT_NAME
ENC_CLIENT_NAME=$(python3 - <<'PY'
import os
import urllib.parse
print(urllib.parse.quote(os.environ["CLIENT_NAME"]))
PY
)

ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=new-client-open').Content"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/fill?testid=new-client-name&text=$ENC_CLIENT_NAME').Content"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=new-client-create').Content"
```

Send the locked Wave 1 checklist:

```bash
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=intake-template-new-household').Content"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=intake-send-link').Content"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=intake-copy-link').Content" \
  | tee "$EVIDENCE/intake-link.txt"
```

Pass means:

- The copied link starts with `https://intake-staging.lanternplatform.app/i/`.
- The link contains `#v1.`.
- The app shows the Onboarding tab active for the new client.
- The link controls are present: copy again, extend, revoke, and regenerate.

Keep the full link only in the evidence folder. Do not paste it into chat, email,
or a public log.

## 6. Phone-Sized Browser Client Walk

This uses Playwright on the Legion with a phone-sized viewport. It proves the
staged page, relay, encrypted uploads, and desktop round trip. It does not prove
real iOS Safari or Android Chrome camera behavior. See section 10 for that.

### 6.1 Prepare Upload Fixtures On The Legion

```bash
ssh "$LEGION" "New-Item -ItemType Directory -Force C:\w1bench | Out-Null; Set-Content -Path C:\w1bench\license-front.jpg -Value 'front-image-$STAMP'; Set-Content -Path C:\w1bench\license-back.jpg -Value 'back-image-$STAMP'"
```

### 6.2 Run The Client Walk

Copy the link from `$EVIDENCE/intake-link.txt` into `CLIENT_LINK` locally, then
run:

```bash
export CLIENT_LINK="$(cat "$EVIDENCE/intake-link.txt" | tr -d '\r\n')"
python3 - <<'PY' > "$EVIDENCE/w1-phone-browser.mjs"
import os
script = r'''
import { chromium, expect } from '@playwright/test';

const clientLink = process.env.CLIENT_LINK;
if (!clientLink) throw new Error('CLIENT_LINK missing');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(clientLink);
await expect(page.getByRole('heading', { name: /Welcome to/ })).toBeVisible();
await expect(page.getByText('This page locks your information on your device.')).toBeVisible();
await page.screenshot({ path: 'C:/w1bench/01-welcome.png', fullPage: true });

await page.getByRole('button', { name: 'Start' }).click();
await expect(page.getByRole('heading', { name: 'Date of birth' })).toBeVisible();
await page.getByLabel('Date of birth', { exact: true }).fill('1960-02-03');
await page.getByRole('button', { name: 'Save and continue' }).click();
await expect(page.getByRole('heading', { name: 'Social Security number' })).toBeVisible();

await page.getByLabel('Social Security number', { exact: true }).fill('123-45-6789');
await page.getByRole('button', { name: 'Save and continue' }).click();
await expect(page.getByRole('heading', { name: /Driver.*license/ })).toBeVisible();
await page.screenshot({ path: 'C:/w1bench/02-license-before-upload.png', fullPage: true });

await page.getByLabel('License front photo').setInputFiles('C:/w1bench/license-front.jpg');
await page.getByLabel('License back photo').setInputFiles('C:/w1bench/license-back.jpg');
await expect(page.getByText('front ready')).toBeVisible();
await expect(page.getByText('back ready')).toBeVisible();
await page.getByRole('button', { name: 'Save and continue' }).click();
await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();

await page.getByRole('button', { name: 'Enter an amount' }).click();
await page.getByLabel('Yearly amount').fill('90,000');
await page.getByRole('button', { name: 'Save and continue' }).click();
await expect(page.getByRole('heading', { name: 'Spending' })).toBeVisible();

await page.getByRole('button', { name: "I don't know yet" }).click();
await page.getByRole('button', { name: 'Save and continue' }).click();
await expect(page.getByRole('heading', { name: "That's everything for now." })).toBeVisible();
await page.screenshot({ path: 'C:/w1bench/03-complete.png', fullPage: true });

await page.reload();
await page.getByRole('button', { name: /Social Security number.*provided/i }).click();
await expect(page.locator('body')).not.toContainText('123-45-6789');
await expect(page.locator('body')).not.toContainText('6789');
await page.screenshot({ path: 'C:/w1bench/04-reload-write-only.png', fullPage: true });

await browser.close();
console.log('W1 phone-sized browser client walk passed');
'''
print(script)
PY

scp "$EVIDENCE/w1-phone-browser.mjs" "$LEGION":C:/w1bench/w1-phone-browser.mjs
ssh "$LEGION" "cd C:\keepance; \$env:CLIENT_LINK='$CLIENT_LINK'; node C:\w1bench\w1-phone-browser.mjs" \
  2>&1 | tee "$EVIDENCE/w1-phone-browser.log"
scp "$LEGION":C:/w1bench/*.png "$EVIDENCE"/
```

Pass means:

- Welcome shows the firm name from the sealed checklist, not a URL parameter.
- DOB saves and advances to SSN.
- SSN saves only when 9 digits are present and advances to license.
- License front and back both show ready before save.
- Income accepts `90,000` and advances to spending.
- Spending accepts `I don't know yet`.
- Completion page appears.
- After reload, the page shows the item as provided but does not show the SSN,
  last four digits, or file names.

## 7. Desktop-Side Verification

Use the app bridge to pull new submissions down. Ack must happen only after local
durable writes, so the relay should still hold ciphertext if the app crashes
before this step.

```bash
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=onboarding-sync-now').Content" \
  | tee "$EVIDENCE/app-sync-click.json"
```

If the UI has no sync button because sync is automatic, poll the Onboarding tab:

```bash
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=onboarding-checklist').Content" \
  | tee "$EVIDENCE/onboarding-checklist-text.txt"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=onboarding-files-list').Content" \
  | tee "$EVIDENCE/onboarding-files-text.txt"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=onboarding-facts-list').Content" \
  | tee "$EVIDENCE/onboarding-facts-text.txt"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=onboarding-activity-trail').Content" \
  | tee "$EVIDENCE/onboarding-activity-text.txt"
```

Required assertions:

- Checklist shows all five items done: date of birth, Social Security number,
  driver's license, income, spending.
- Files list shows two license images filed under `Requests/onboarding/`.
- Facts list shows DOB present, SSN masked as `...6789` or `***-**-6789`,
  income as `90000` or `$90,000`, and spending as unknown.
- Facts list does not show the full SSN.
- Activity trail has receipt intent and receipt outcome rows for each item, or a
  grouped receipt pair that names all five items.
- Reveal of a restricted fact writes an audit row. Test this only if Lane D
  exposes a reveal button in the bench UI:

```bash
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=onboarding-reveal-ssn').Content" \
  | tee "$EVIDENCE/onboarding-reveal-ssn.json"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=onboarding-activity-trail').Content" \
  | tee "$EVIDENCE/onboarding-activity-after-reveal.txt"
```

Pass means the trail now contains a restricted-fact reveal audit entry.

### 7.1 File-System Check On Windows

Use the app UI path if available. Otherwise ask the app for its active workspace
root through the bridge:

```bash
JS='JSON.stringify({root: window.__LANTERN_WORKSPACE_ROOT__ ?? null})'
export JS
ENC=$(python3 - <<PY
import urllib.parse, os
print(urllib.parse.quote(os.environ["JS"]))
PY
)
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/eval?js=$ENC').Content" \
  | tee "$EVIDENCE/workspace-root.json"
```

If the app does not expose `window.__LANTERN_WORKSPACE_ROOT__`, use the client
folder path shown in the Documents tab and record it in the evidence note.

On the Legion, check the files:

```bash
ssh "$LEGION" "Get-ChildItem -Recurse -File C:\keepance -Include '*license*','*front*','*back*' | Select-Object FullName,Length,LastWriteTime | Format-List" \
  | tee "$EVIDENCE/windows-license-file-search.txt"
```

Pass means two new files exist for this client under a path containing
`Requests\onboarding`.

## 8. Regenerate Link Check

This proves V10: the old link dies, and the new link still decrypts the page.

```bash
OLD_LINK="$CLIENT_LINK"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=onboarding-regenerate-link').Content" \
  | tee "$EVIDENCE/regenerate-click.json"
ssh "$LEGION" "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/text?testid=intake-copy-link').Content" \
  | tee "$EVIDENCE/intake-link-regenerated.txt"
NEW_LINK="$(cat "$EVIDENCE/intake-link-regenerated.txt" | tr -d '\r\n')"
```

Open the old link in the phone-sized browser. Expected result: neutral unavailable
or expired/revoked page.

Open the new link. Expected result: page opens and shows the same checklist state
with the already completed items marked provided. If the new link cannot decrypt
the checklist or state, Lane D did not re-seal both blobs under the new page key.

## 9. Relay Storage Dump Inspection

The manual dump is the human version of the standing privacy-proof test. It is
not looking for "no metadata." It is looking for no readable client values,
client names, item labels, or file names.

Use these exact sentinel strings from the bench:

```bash
cat > "$EVIDENCE/forbidden-relay-strings.txt" <<EOF
Sarah Plainclient
$CLIENT_NAME
123-45-6789
123456789
6789
license-front.jpg
license-back.jpg
front-image-$STAMP
back-image-$STAMP
Date of birth
Social Security number
Driver's license
Income
Spending
EOF
```

Dump the intake tables:

```bash
sqlite3 "$RELAY_DB" ".headers on" ".mode quote" \
  "select intake_id, org_id, user_id, seat_id, token_hash, expires_at, status, checklist_version, created_at, revoked_at, length(checklist_ciphertext) as checklist_bytes, length(state_ciphertext) as state_bytes from intakes order by created_at desc limit 10;" \
  > "$EVIDENCE/relay-intakes.csv"

sqlite3 "$RELAY_DB" ".headers on" ".mode quote" \
  "select id, intake_id, item_id, submission_id, idx, size, created_at, bound_at, length(ciphertext) as ciphertext_bytes from intake_chunks order by id desc limit 50;" \
  > "$EVIDENCE/relay-chunks.csv"

sqlite3 "$RELAY_DB" ".headers on" ".mode quote" \
  "select id, intake_id, item_id, submission_id, chunk_count, created_at, acked_at, length(manifest_ciphertext) as manifest_bytes, length(wrapped_content_key) as wrapped_key_bytes from intake_submissions order by id desc limit 50;" \
  > "$EVIDENCE/relay-submissions.csv"
```

Search both the database bytes and the readable dump:

```bash
strings -a "$RELAY_DB" > "$EVIDENCE/relay-db-strings.txt"
cat "$EVIDENCE"/relay-*.csv > "$EVIDENCE/relay-readable-dump.txt"

while IFS= read -r needle; do
  [ -z "$needle" ] && continue
  if rg -F "$needle" "$EVIDENCE/relay-db-strings.txt" "$EVIDENCE/relay-readable-dump.txt"; then
    echo "FAIL readable relay string: $needle" | tee -a "$EVIDENCE/relay-privacy-result.txt"
  fi
done < "$EVIDENCE/forbidden-relay-strings.txt"

test ! -s "$EVIDENCE/relay-privacy-result.txt" && echo "PASS no forbidden readable relay strings" \
  | tee "$EVIDENCE/relay-privacy-result.txt"
```

Allowed to appear:

- `intake_id`
- opaque `item_id`
- `submission_id`
- timestamps
- sizes
- token HMAC
- ciphertext lengths and hex/base64-looking bytes

Not allowed:

- client name
- full or partial SSN
- license photo file names
- image contents
- item labels
- advisor-facing checklist copy

If item ids are human-readable, such as `ssn` or `license`, record it as a
finding. The schema stores item ids for routing, but production item ids should
be opaque enough that the relay dump does not explain the checklist.

After desktop sync and ack, repeat the chunk/submission queries. Pass means the
acked ciphertext chunks are deleted and finalized submissions have their
`manifest_ciphertext` and `wrapped_content_key` wiped or marked acked according
to the Lane B ack contract.

## 10. Real Phone Camera Verification

The Legion phone-sized browser does not prove V7. It proves the desktop-sized
browser can be made phone-shaped, and that file inputs and upload encryption work.

V7 needs real devices:

- Android Chrome on a physical Android phone.
- iOS Safari on a physical iPhone or a real-device browser service.

Minimum V7 script:

1. Open the staged link on the real phone.
2. Confirm the welcome page renders and shows the firm name.
3. Tap Start.
4. Reach the driver's license item.
5. Tap Take a photo for front and back.
6. Confirm the operating system opens the real camera, not only the file picker.
7. Take two throwaway photos.
8. Save and continue.
9. Finish the remaining items.
10. Confirm the desktop receives and files the two photos.

Evidence needed for V7:

- One photo of the physical phone on the camera-capture prompt.
- One screenshot of the completed mobile page.
- Desktop evidence that the same submission arrived.

Until this is done, mark V7 as open even if the Legion phone-sized browser passed.

## 11. Evidence Checklist

Save these in `$EVIDENCE` and paste the important lines into the Wave 1 merge
note:

- `gate.log` tail: green `npm run gate`.
- `backend-bun-test.log` tail: green Bun tests.
- `intake-page-playwright.log` tail: green page tests and axe pass.
- `intake-headers-test.log`, `intake-integrity-test.log`,
  `intake-fragment-check.log`: all green.
- `intake-staging-dry-run.log`: bundle version and bundle hash.
- `intake-deploy-staging.log`: staging publish, bundle hash, checked assets.
- `intake-page-headers.txt`: CSP and no-referrer headers.
- `legion-dev-log-tail.txt`: Tauri dev ready lines.
- `legion-bridge-health.json`: bridge alive.
- `legion-agent-health.json`: screen agent alive.
- `01-welcome.png`, `02-license-before-upload.png`, `03-complete.png`,
  `04-reload-write-only.png`.
- `w1-phone-browser.log`: `W1 phone-sized browser client walk passed`.
- `onboarding-checklist-text.txt`: all five items done.
- `onboarding-files-text.txt`: two license files in `Requests/onboarding/`.
- `onboarding-facts-text.txt`: facts present, SSN masked.
- `onboarding-activity-text.txt`: receipt audit rows.
- `windows-license-file-search.txt`: filesystem proof of filed documents.
- `relay-intakes.csv`, `relay-chunks.csv`, `relay-submissions.csv`.
- `relay-privacy-result.txt`: no forbidden readable relay strings.
- Caddy and cloudflared status lines for the staging hosts.
- If V7 ran: physical Android Chrome and iOS Safari camera evidence.

## 12. Bench Pass Statement

Wave 1 bench passes only when all of these are true:

- Staged page opens from `https://intake-staging.lanternplatform.app`.
- The client completes DOB, SSN, license front/back, income, and spending.
- The page never shows the submitted SSN or last four digits after reload.
- The desktop app decrypts the submissions.
- Two license images are filed in the client folder under `Requests/onboarding/`.
- DOB, SSN, income, and spending facts are in the encrypted facts store, with SSN
  masked in the UI.
- Checklist state on the client page and the advisor Onboarding tab agrees.
- Audit rows exist for intake receipt, filing outcome, and restricted reveal if
  reveal was tested.
- Relay dump contains no readable client values, client name, item labels, file
  names, or image contents.
- Regenerate kills the old link and the new link still opens.
- V7 is either completed on real phones or explicitly left open as a real-device
  VERIFY-LIVE item.
