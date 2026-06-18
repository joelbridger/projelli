/**
 * 14-matters - creates matters, switches active scope, and verifies manager UI.
 */

import fs from 'node:fs';
import path from 'node:path';

export default {
  name: '14-matters',
  async run({ session, workspace, app }) {
    const anchorFile = path.join(workspace, 'matter-scope-anchor.md');
    fs.writeFileSync(anchorFile, '# Matter scope anchor\n\nUsed by the desktop matter scope spec.\n');

    await app.bootToWorkspace(session, { workspacePath: workspace });

    await app.gotoSurface(session, 'Matters');
    await session.waitForBodyText('Matters', { timeoutMs: 20_000 });

    await openMatterManagerFromMatters(session, app);
    await session.testid('matter-manager-dialog', 10_000);

    const alphaName = uniqueName('Alpha v. Beta');
    const alphaClient = 'Alpha Manufacturing';
    const betaName = uniqueName('Beta Licensing');
    const betaClient = 'Beta Labs';

    await createMatter(session, alphaName, alphaClient);
    const alphaId = await matterIdByText(session, alphaName);
    await session.testid(`matter-name-${alphaId}`, 10_000);
    await session.testid(`matter-client-${alphaId}`, 10_000);

    await createMatter(session, betaName, betaClient);
    const betaId = await matterIdByText(session, betaName);
    await session.testid(`matter-name-${betaId}`, 10_000);
    await session.testid(`matter-client-${betaId}`, 10_000);

    await closeDialog(session, app);

    await session.clickTestid(`matter-row-${alphaId}`, 20_000);
    await session.waitForBodyText(alphaName, { timeoutMs: 20_000 });

    await app.gotoSurface(session, 'Documents');
    await session.clickTestid(`grid-card-${path.basename(anchorFile)}`, 20_000);
    await session.waitForBodyText('Matter scope anchor', { timeoutMs: 20_000 });
    await openAIAssistant(session);

    await session.testid('matter-scope-selector', 20_000);
    await waitForScope(session, { scope: 'matter', matterId: alphaId });

    await session.clickTestid('matter-scope-selector', 10_000);
    await session.clickTestid('matter-scope-option-all', 10_000);
    await waitForScope(session, { scope: 'allMatters', matterId: '' });

    await session.clickTestid('matter-scope-selector', 10_000);
    await session.clickTestid(`matter-scope-option-${betaId}`, 10_000);
    await waitForScope(session, { scope: 'matter', matterId: betaId });

    await session.clickTestid('matter-scope-selector', 10_000);
    await session.clickTestid('matter-scope-manage', 10_000);
    await session.testid('matter-manager-dialog', 10_000);
    await session.testid(`matter-row-${alphaId}`, 10_000);
    await session.testid(`matter-row-${betaId}`, 10_000);
  },
};

async function openMatterManagerFromMatters(session, app) {
  const button = await session.find(
    'xpath',
    `//button[contains(normalize-space(.), ${app.xpathLiteral('New matter')}) or normalize-space(.)=${app.xpathLiteral('Create')}]`,
    20_000,
  );
  await session.click(button);
}

async function createMatter(session, name, client) {
  const nameInput = await session.testid('matter-new-name', 10_000);
  const clientInput = await session.testid('matter-new-client', 10_000);
  await session.clear(nameInput);
  await session.clear(clientInput);
  await session.type(nameInput, name);
  await session.type(clientInput, client);
  await session.clickTestid('matter-create-button', 10_000);
  await session.waitForBodyText(name, { timeoutMs: 20_000 });
}

async function matterIdByText(session, text) {
  return session.waitFor(
    async () => {
      return session.execute(
        `
          const rows = [...document.querySelectorAll('[data-testid^="matter-row-"]')];
          const row = rows.find((el) => el.textContent.includes(arguments[0]));
          return row ? row.getAttribute('data-testid').replace('matter-row-', '') : null;
        `,
        [text],
      );
    },
    { timeoutMs: 20_000, intervalMs: 400, label: `matter row for ${text}` },
  );
}

async function closeDialog(session, app) {
  const close = await session.find(
    'xpath',
    `//button[@aria-label=${app.xpathLiteral('Close')} or .//*[normalize-space()=${app.xpathLiteral('Close')}]]`,
    5_000,
  );
  await session.click(close);
  await session.waitFor(
    async () => !(await session.hasTestid('matter-manager-dialog', 500)),
    { timeoutMs: 10_000, intervalMs: 300, label: 'matter manager closed' },
  );
}

async function openAIAssistant(session) {
  await pressShortcut(session, 'a', { ctrlKey: true, shiftKey: true });
  await session.testid('ai-assistant-tab', 15_000);
  await session.testid('matter-scope-selector', 15_000);
}

async function pressShortcut(session, key, opts = {}) {
  await session.execute(
    `
      const event = new KeyboardEvent('keydown', {
        key: arguments[0],
        code: arguments[0].length === 1 ? 'Key' + arguments[0].toUpperCase() : arguments[0],
        ctrlKey: Boolean(arguments[1].ctrlKey),
        metaKey: Boolean(arguments[1].metaKey),
        shiftKey: Boolean(arguments[1].shiftKey),
        altKey: Boolean(arguments[1].altKey),
        bubbles: true,
        cancelable: true
      });
      const target = document.activeElement || document.body;
      target.dispatchEvent(event);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: arguments[0],
        code: arguments[0].length === 1 ? 'Key' + arguments[0].toUpperCase() : arguments[0],
        ctrlKey: Boolean(arguments[1].ctrlKey),
        metaKey: Boolean(arguments[1].metaKey),
        shiftKey: Boolean(arguments[1].shiftKey),
        altKey: Boolean(arguments[1].altKey),
        bubbles: true,
        cancelable: true
      }));
    `,
    [key, opts],
  );
}

async function waitForScope(session, { scope, matterId }) {
  await session.waitFor(
    async () => {
      return session.execute(
        `
          const el = document.querySelector('[data-testid="matter-scope-selector"]');
          if (!el) return false;
          return el.getAttribute('data-scope') === arguments[0]
            && el.getAttribute('data-matter-id') === arguments[1];
        `,
        [scope, matterId],
      );
    },
    { timeoutMs: 10_000, intervalMs: 300, label: `scope ${scope}:${matterId}` },
  );
}

function uniqueName(prefix) {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
