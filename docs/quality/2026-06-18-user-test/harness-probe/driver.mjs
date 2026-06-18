#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const {
  TAURI_APP,
  TAURI_DRIVER_PORT = '4444',
  PROBE_SCREENSHOT,
  PROBE_WORKSPACE,
} = process.env;

if (!TAURI_APP || !PROBE_SCREENSHOT || !PROBE_WORKSPACE) {
  throw new Error('TAURI_APP, PROBE_SCREENSHOT, and PROBE_WORKSPACE must be set.');
}

const base = `http://127.0.0.1:${TAURI_DRIVER_PORT}`;

async function request(method, route, body, allowWebDriverError = false) {
  const response = await fetch(base + route, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${method} ${route} returned non-JSON ${response.status}: ${raw.slice(0, 500)}`);
  }

  if (
    !allowWebDriverError &&
    (!response.ok || (json.value && typeof json.value === 'object' && json.value.error))
  ) {
    throw new Error(`${method} ${route} failed ${response.status}: ${JSON.stringify(json).slice(0, 1400)}`);
  }

  return json;
}

function elementId(elementResponse) {
  const value = elementResponse.value;
  return value['element-6066-11e4-a52e-4f735466cecf'] || value.ELEMENT;
}

async function findElement(sessionId, using, value, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      return elementId(await request('POST', `/session/${sessionId}/element`, { using, value }));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Element not found after ${timeoutMs}ms: ${using}=${value}. Last error: ${lastError?.message}`);
}

async function click(sessionId, element) {
  await request('POST', `/session/${sessionId}/element/${element}/click`, {});
}

async function maybeClick(sessionId, using, value, timeoutMs = 2_000) {
  try {
    const element = await findElement(sessionId, using, value, timeoutMs);
    await click(sessionId, element);
    return true;
  } catch {
    return false;
  }
}

async function execute(sessionId, script, args = []) {
  const response = await request('POST', `/session/${sessionId}/execute/sync`, { script, args });
  return response.value;
}

async function takeScreenshot(sessionId, file) {
  const response = await request('GET', `/session/${sessionId}/screenshot`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(response.value, 'base64'));
}

const startedAt = Date.now();
let sessionId;

try {
  const sessionResponse = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        'tauri:options': {
          application: TAURI_APP,
          args: [],
        },
      },
    },
  });

  sessionId = sessionResponse.sessionId || sessionResponse.value?.sessionId;
  if (!sessionId) {
    throw new Error(`No WebDriver session id in response: ${JSON.stringify(sessionResponse)}`);
  }

  await findElement(sessionId, 'css selector', '[data-testid="welcome-dialog-pitch"]', 30_000);

  const hasTauri = await execute(sessionId, 'return Boolean(window.__TAURI__);');
  if (!hasTauri) {
    throw new Error('window.__TAURI__ is missing; this is not the desktop webview.');
  }

  await execute(
    sessionId,
    `
      localStorage.setItem('keepance_onboarding_complete', 'true');
      localStorage.setItem('keepance_profession', 'legal');
      localStorage.setItem('keepance_feature_tour_dismissed', 'true');
      localStorage.setItem('keepance_feature_tour_completed', 'true');
      localStorage.setItem('keepance_recent_workspaces', JSON.stringify([{
        path: arguments[0],
        name: 'wd-workspace',
        lastOpened: new Date().toISOString()
      }]));
    `,
    [PROBE_WORKSPACE],
  );

  await request('POST', `/session/${sessionId}/refresh`, {});

  const recentToggle = await findElement(sessionId, 'css selector', '[data-testid="recent-workspaces-toggle"]', 30_000);
  await click(sessionId, recentToggle);

  const recentWorkspace = await findElement(
    sessionId,
    'xpath',
    "//button[.//div[normalize-space()='wd-workspace']]",
    20_000,
  );
  await click(sessionId, recentWorkspace);

  await findElement(sessionId, 'css selector', '[data-testid="spine-nav"]', 45_000);
  await findElement(sessionId, 'css selector', '[data-testid="status-bar"]', 15_000);
  await findElement(sessionId, 'css selector', '[data-testid="documents-toolbar"]', 15_000);
  await findElement(sessionId, 'css selector', '[data-testid="documents-tab-strip"]', 15_000);
  await maybeClick(sessionId, 'css selector', '[data-testid="feature-tour-skip"]');

  const bodyText = await execute(sessionId, 'return document.body.innerText;');
  if (!bodyText.includes('probe.md')) {
    throw new Error(`Workspace shell rendered, but probe.md was not visible. Body text: ${bodyText.slice(0, 1000)}`);
  }

  await takeScreenshot(sessionId, PROBE_SCREENSHOT);

  const elapsedMs = Date.now() - startedAt;
  console.log(`PASS workspace shell rendered via real Tauri app in ${elapsedMs}ms`);
  console.log(`TAURI_APP ${TAURI_APP}`);
  console.log(`WORKSPACE ${PROBE_WORKSPACE}`);
  console.log('ASSERTIONS window.__TAURI__=true, spine-nav visible, Documents shell visible, status-bar visible, real file probe.md visible');
  console.log(`SCREENSHOT ${PROBE_SCREENSHOT}`);
} finally {
  if (sessionId) {
    await request('DELETE', `/session/${sessionId}`, {}, true).catch(() => {});
  }
}
