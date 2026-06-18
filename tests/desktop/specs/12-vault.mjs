/**
 * 12-vault — encrypted workspace vault, driven through the real Tauri app.
 *
 * Current product gap, documented in the 2026-06-18 inventory:
 * VaultEnableFlow exists but is not mounted in a reachable production UI. This
 * spec therefore uses the registered Tauri vault commands as setup for enable /
 * disable, then drives the real locked-workspace recovery prompt through the UI.
 * It throws BLOCKED at the end so the suite does not report false full UI
 * coverage for the missing enable and unlocked escape-hatch surfaces.
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_NAME = 'vault-workspace';
const VMK_KEY = 'vmk-v1';

const FIXTURES = [
  {
    rel: 'client-intake.txt',
    content: [
      'Client: Aurora Biologics',
      'Matter: privilege-sensitive licensing review',
      'Note: the settlement number is 41872.',
      '',
    ].join('\n'),
  },
  {
    rel: path.join('matter-notes', 'strategy.md'),
    content: [
      '# Strategy notes',
      '',
      'Preserve draft claims, source citations, and outside-counsel comments.',
      'Round-trip marker: VAULT-CONTENT-77319.',
      '',
    ].join('\n'),
  },
];

function fixturePath(workspace, rel) {
  return path.join(workspace, rel);
}

function seedFixtures(workspace) {
  for (const fixture of FIXTURES) {
    const abs = fixturePath(workspace, fixture.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, fixture.content, 'utf8');
  }
}

function assertPlaintextMatches(workspace, label) {
  for (const fixture of FIXTURES) {
    const got = fs.readFileSync(fixturePath(workspace, fixture.rel), 'utf8');
    if (got !== fixture.content) {
      throw new Error(`${label}: ${fixture.rel} did not round-trip intact`);
    }
  }
}

function assertEncryptedOnDisk(workspace) {
  for (const fixture of FIXTURES) {
    const bytes = fs.readFileSync(fixturePath(workspace, fixture.rel));
    const header = bytes.subarray(0, 4).toString('utf8');
    if (header !== 'KPV1') {
      throw new Error(`${fixture.rel} was not KPV1-encrypted on disk`);
    }
    if (bytes.includes(Buffer.from(fixture.content, 'utf8'))) {
      throw new Error(`${fixture.rel} still contains plaintext after vault encryption`);
    }
  }
}

function assertVaultMetadataExists(workspace) {
  if (!fs.existsSync(path.join(workspace, '.keepance-vault.json'))) {
    throw new Error('vault metadata .keepance-vault.json was not created');
  }
}

function assertVaultMetadataRemoved(workspace) {
  if (fs.existsSync(path.join(workspace, '.keepance-vault.json'))) {
    throw new Error('vault metadata .keepance-vault.json still exists after disable');
  }
}

function normalizeInvokeError(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    return JSON.stringify(error);
  }
  return String(error);
}

function isKeychainUnavailable(error) {
  const s = normalizeInvokeError(error).toLowerCase();
  return (
    s.includes('keychain') ||
    s.includes('secret service') ||
    s.includes('dbus') ||
    s.includes('no storage') ||
    s.includes('denied') ||
    s.includes('platform failure') ||
    s.includes('no backend')
  );
}

async function invokeTauri(session, command, args = {}) {
  const result = await session.execute(
    `
      const command = arguments[0];
      const args = arguments[1] || {};
      const invoke =
        window.__TAURI_INTERNALS__?.invoke ||
        window.__TAURI__?.core?.invoke ||
        window.__TAURI__?.invoke;

      if (typeof invoke !== 'function') {
        return {
          ok: false,
          error: 'Tauri invoke bridge missing from the desktop webview',
        };
      }

      return Promise.resolve(invoke(command, args)).then(
        (value) => ({ ok: true, value }),
        (error) => ({
          ok: false,
          error: error && typeof error === 'object'
            ? JSON.parse(JSON.stringify(error))
            : String(error),
        }),
      );
    `,
    [command, args],
  );

  if (!result?.ok) {
    const err = new Error(`${command} failed: ${normalizeInvokeError(result?.error)}`);
    err.invokeError = result?.error;
    throw err;
  }
  return result.value;
}

async function invokeOrBlockOnKeychain(session, command, args, blockedMessage) {
  try {
    return await invokeTauri(session, command, args);
  } catch (err) {
    if (isKeychainUnavailable(err.invokeError ?? err.message)) {
      throw new Error(`${blockedMessage} Native error: ${normalizeInvokeError(err.invokeError ?? err.message)}`);
    }
    throw err;
  }
}

async function openRecentWorkspaceExpectLockedPrompt(session, app, workspace) {
  await session.newSession();
  await session.testid('welcome-dialog-pitch', 30_000);

  const hasTauri = await session.execute('return Boolean(window.__TAURI__);');
  if (!hasTauri) throw new Error('window.__TAURI__ missing; not the desktop webview.');

  await app.seedReadyState(session, workspace, { workspaceName: WORKSPACE_NAME });
  await session.refresh();
  await session.clickTestid('recent-workspaces-toggle', 30_000);

  const recent = await session.find(
    'xpath',
    `//button[.//div[normalize-space()=${app.xpathLiteral(WORKSPACE_NAME)}]]`,
    20_000,
  );
  await session.click(recent);
  await session.testid('recovery-phrase-input', 30_000);
  await session.waitForBodyText('Vault locked', { timeoutMs: 20_000 });
}

async function clickButtonByText(session, app, text, timeoutMs = 20_000) {
  const button = await session.find(
    'xpath',
    `//button[normalize-space()=${app.xpathLiteral(text)}]`,
    timeoutMs,
  );
  await session.click(button);
}

export default {
  name: '12-vault',
  async run({ session, workspace, app, log }) {
    seedFixtures(workspace);
    assertPlaintextMatches(workspace, 'seed');

    await app.bootToWorkspace(session, {
      workspacePath: workspace,
      workspaceName: WORKSPACE_NAME,
    });
    await session.testid('documents-toolbar', 15_000);
    await session.testid('documents-tab-strip', 15_000);
    await session.waitForBodyText('client-intake.txt', { timeoutMs: 15_000 });
    await session.waitForBodyText('matter-notes', { timeoutMs: 15_000 });

    const enableUiPresent = (await session.bodyText()).includes('Enable vault');
    if (!enableUiPresent) {
      log('Vault enable UI is not mounted; using native vault commands as setup and blocking at the end.');
    }

    const created = await invokeOrBlockOnKeychain(
      session,
      'vault_create',
      { workspace, escrow: false },
      'BLOCKED: needs a working OS keychain or Linux Secret Service backend for vault_create to store the vault master key in the headless desktop profile.',
    );
    const recoveryPhrase = created?.recoveryPhrase;
    const vaultId = created?.vaultId;
    if (!recoveryPhrase || !vaultId) {
      throw new Error(`vault_create returned an unexpected payload: ${JSON.stringify(created)}`);
    }

    await invokeOrBlockOnKeychain(
      session,
      'vault_encrypt_all',
      { workspace },
      'BLOCKED: needs the vault master key available in the OS keychain so vault_encrypt_all can encrypt the workspace.',
    );
    assertVaultMetadataExists(workspace);
    assertEncryptedOnDisk(workspace);

    const unlockedStatus = await invokeTauri(session, 'vault_status', { workspace });
    if (!unlockedStatus.enabled || unlockedStatus.locked) {
      throw new Error(`vault should be enabled and unlocked after create/encrypt: ${JSON.stringify(unlockedStatus)}`);
    }

    await invokeOrBlockOnKeychain(
      session,
      'keychain_delete',
      { service: `com.keepance.vault.${vaultId}`, key: VMK_KEY },
      'BLOCKED: needs OS keychain deletion support to simulate a fresh machine for vault recovery.',
    );
    const lockedStatus = await invokeTauri(session, 'vault_status', { workspace });
    if (!lockedStatus.enabled || !lockedStatus.locked) {
      throw new Error(`vault should be locked after deleting VMK: ${JSON.stringify(lockedStatus)}`);
    }

    await session.close();
    await openRecentWorkspaceExpectLockedPrompt(session, app, workspace);

    await session.typeTestid('recovery-phrase-input', recoveryPhrase, 10_000);
    await clickButtonByText(session, app, 'Unlock');
    await session.testid('documents-toolbar', 45_000);
    await session.waitForBodyText('client-intake.txt', { timeoutMs: 20_000 });
    await session.waitForBodyText('matter-notes', { timeoutMs: 20_000 });

    const recoveredStatus = await invokeTauri(session, 'vault_status', { workspace });
    if (!recoveredStatus.enabled || recoveredStatus.locked) {
      throw new Error(`vault should be unlocked after recovery phrase: ${JSON.stringify(recoveredStatus)}`);
    }

    assertEncryptedOnDisk(workspace);

    const escapeHatchUiPresent = (await session.bodyText()).includes('Turn off vault and decrypt files');
    if (!escapeHatchUiPresent) {
      log('Unlocked escape-hatch UI is not mounted; using native decrypt/disable commands and blocking at the end.');
    }

    await invokeOrBlockOnKeychain(
      session,
      'vault_decrypt_all',
      { workspace },
      'BLOCKED: needs the vault master key available in the OS keychain so the escape hatch can decrypt files before disable.',
    );
    await invokeTauri(session, 'vault_disable', { workspace });

    assertVaultMetadataRemoved(workspace);
    assertPlaintextMatches(workspace, 'disable');

    const disabledStatus = await invokeTauri(session, 'vault_status', { workspace });
    if (disabledStatus.enabled || disabledStatus.locked) {
      throw new Error(`vault should be disabled after decrypt/disable: ${JSON.stringify(disabledStatus)}`);
    }

    const blocked = [];
    if (!enableUiPresent) {
      blocked.push('a production-mounted VaultEnableFlow entry point with stable open/enable/ceremony/progress/done test IDs');
    }
    if (!escapeHatchUiPresent) {
      blocked.push('a reachable unlocked vault escape-hatch UI, or a recovery-aware locked escape hatch that restores the VMK before decrypting');
    }
    if (blocked.length > 0) {
      throw new Error(`BLOCKED: needs ${blocked.join('; ')}.`);
    }
  },
};
