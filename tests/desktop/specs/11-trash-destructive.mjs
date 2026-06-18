import fs from 'node:fs';
import path from 'node:path';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDisk(predicate, label, timeoutMs = 20_000) {
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = predicate();
      if (result) return result;
    } catch (error) {
      lastErr = error;
    }
    await sleep(350);
  }
  throw new Error(`Timed out waiting for ${label}. Last: ${lastErr?.message ?? 'falsy'}`);
}

function readTrashMetadata(workspace) {
  const metadataPath = path.join(workspace, '.trash', 'metadata.json');
  if (!fs.existsSync(metadataPath)) return [];
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

function trashEntryFor(workspace, name) {
  return readTrashMetadata(workspace).find((item) => item.name === name);
}

async function clickButtonText(session, app, text, timeoutMs = 15_000) {
  const button = await session.find(
    'xpath',
    `//button[normalize-space()=${app.xpathLiteral(text)}]`,
    timeoutMs,
  );
  await session.click(button);
}

async function clickDialogButtonText(session, app, text, timeoutMs = 15_000) {
  const button = await session.find(
    'xpath',
    `//*[@role="dialog" or @role="alertdialog"]//button[normalize-space()=${app.xpathLiteral(text)}]`,
    timeoutMs,
  );
  await session.click(button);
}

async function fillPrompt(session, app, value, confirmText = 'OK') {
  const input = await session.find('xpath', '//div[@role="dialog"]//input', 15_000);
  await session.clear(input);
  await session.type(input, value);
  await clickDialogButtonText(session, app, confirmText, 10_000);
}

async function activateFilesView(session, app) {
  const files = await session.find(
    'xpath',
    `//button[normalize-space()=${app.xpathLiteral('Files')}]`,
    15_000,
  );
  await session.click(files);
  await session.testid('documents-toolbar', 15_000);
  await session.clickTestid('docs-view-tree', 15_000);
}

async function activateTrashView(session, app) {
  await activateFilesView(session, app);
  const trash = await session.find(
    'xpath',
    `//button[.//text()[normalize-space()=${app.xpathLiteral('Trash')}]]`,
    15_000,
  );
  await session.click(trash);
  await session.waitForBodyText('Trash', { timeoutMs: 15_000 });
}

async function openTreeRowMenu(session, fileName) {
  const opened = await session.execute(
    `
      const name = arguments[0];
      const rows = Array.from(document.querySelectorAll('[role="treeitem"]'));
      const row = rows.find((el) => (el.textContent || '').includes(name));
      if (!row) return false;
      const button = row.querySelector('button[aria-label="File options"]');
      if (!button) return false;
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }));
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      button.click();
      return true;
    `,
    [fileName],
  );
  if (!opened) throw new Error(`Could not open file-tree row menu for ${fileName}`);
}

async function clickMenuItem(session, app, label) {
  const clicked = await session.waitFor(
    async () => session.execute(
      `
        const label = arguments[0];
        const items = Array.from(document.querySelectorAll('[role="menuitem"], [data-radix-collection-item]'));
        const item = items.find((el) => (el.textContent || '').trim() === label);
        if (!item) return false;
        item.click();
        return true;
      `,
      [label],
    ),
    { timeoutMs: 10_000, intervalMs: 250, label: `menu item "${label}"` },
  );
  if (!clicked) throw new Error(`Could not click menu item "${label}"`);
}

async function deleteFileToTrash(session, app, workspace, fileName) {
  await activateFilesView(session, app);
  await session.waitForBodyText(fileName, { timeoutMs: 15_000 });
  await openTreeRowMenu(session, fileName);
  await clickMenuItem(session, app, 'Delete');
  await session.waitForBodyText('Delete File', { timeoutMs: 15_000 });
  await clickDialogButtonText(session, app, 'Delete');
  const originalPath = path.join(workspace, fileName);
  await waitForDisk(() => !fs.existsSync(originalPath), `${fileName} removed from original path`);
  const entry = await waitForDisk(() => {
    const item = trashEntryFor(workspace, fileName);
    if (!item) return null;
    return fs.existsSync(item.trashPath) ? item : null;
  }, `${fileName} present in .trash metadata and payload`);
  return entry;
}

async function clickTrashRowAction(session, name, title) {
  const clicked = await session.execute(
    `
      const name = arguments[0];
      const title = arguments[1];
      const buttons = Array.from(document.querySelectorAll('button[title]'));
      for (const button of buttons) {
        if (button.getAttribute('title') !== title) continue;
        let node = button.parentElement;
        while (node && node !== document.body) {
          if ((node.textContent || '').includes(name)) {
            node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            button.dispatchEvent(new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
              button: 0,
              buttons: 1,
            }));
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
            button.click();
            return true;
          }
          node = node.parentElement;
        }
      }
      return false;
    `,
    [name, title],
  );
  if (!clicked) throw new Error(`Could not click trash action "${title}" for ${name}`);
}

export default {
  name: '11-trash-destructive',
  async run({ session, workspace, app }) {
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'restore-me.txt'), 'restore me\n');
    fs.writeFileSync(path.join(workspace, 'collision.txt'), 'original collision\n');
    fs.writeFileSync(path.join(workspace, 'collision-replacement.txt'), 'replacement collision\n');
    fs.writeFileSync(path.join(workspace, 'permanent.txt'), 'delete permanently\n');
    fs.writeFileSync(path.join(workspace, 'empty-a.txt'), 'empty trash A\n');
    fs.writeFileSync(path.join(workspace, 'empty-b.txt'), 'empty trash B\n');

    await app.bootToWorkspace(session, { workspacePath: workspace });
    await app.gotoSurface(session, 'Documents');
    await session.testid('documents-toolbar', 15_000);

    // Delete to Trash, then restore through the Trash panel.
    const restoreEntry = await deleteFileToTrash(session, app, workspace, 'restore-me.txt');
    await activateTrashView(session, app);
    await session.waitForBodyText('restore-me.txt', { timeoutMs: 15_000 });
    await clickTrashRowAction(session, 'restore-me.txt', 'Restore');
    await waitForDisk(
      () => fs.existsSync(path.join(workspace, 'restore-me.txt')) && !fs.existsSync(restoreEntry.trashPath),
      'restore-me.txt restored from trash',
    );
    if (trashEntryFor(workspace, 'restore-me.txt')) {
      throw new Error('restore-me.txt still appears in trash metadata after restore');
    }

    // Permanently delete a single trashed item.
    const permanentEntry = await deleteFileToTrash(session, app, workspace, 'permanent.txt');
    await activateTrashView(session, app);
    await session.waitForBodyText('permanent.txt', { timeoutMs: 15_000 });
    await clickTrashRowAction(session, 'permanent.txt', 'Delete permanently');
    await session.waitForBodyText('Permanently Delete?', { timeoutMs: 15_000 });
    await clickDialogButtonText(session, app, 'Delete Permanently');
    await waitForDisk(
      () => !fs.existsSync(permanentEntry.trashPath) && !trashEntryFor(workspace, 'permanent.txt'),
      'permanent.txt permanently removed from trash',
    );
    if (fs.existsSync(path.join(workspace, 'permanent.txt'))) {
      throw new Error('permanent.txt unexpectedly reappeared at its original path');
    }

    // Empty Trash should permanently remove every remaining trashed payload.
    const emptyAEntry = await deleteFileToTrash(session, app, workspace, 'empty-a.txt');
    const emptyBEntry = await deleteFileToTrash(session, app, workspace, 'empty-b.txt');
    await activateTrashView(session, app);
    await session.waitForBodyText('empty-a.txt', { timeoutMs: 15_000 });
    await session.waitForBodyText('empty-b.txt', { timeoutMs: 15_000 });
    await clickButtonText(session, app, 'Empty Trash');
    await session.waitForBodyText('Empty Trash?', { timeoutMs: 15_000 });
    await clickDialogButtonText(session, app, 'Empty Trash');
    await waitForDisk(
      () => {
        const metadata = readTrashMetadata(workspace);
        return metadata.length === 0 && !fs.existsSync(emptyAEntry.trashPath) && !fs.existsSync(emptyBEntry.trashPath);
      },
      'empty trash cleared metadata and all payloads',
    );
    await session.waitForBodyText('Trash is empty', { timeoutMs: 15_000 });

    // Restore collision: recreate the original path before restore and confirm a renamed copy appears.
    const collisionEntry = await deleteFileToTrash(session, app, workspace, 'collision.txt');
    await activateFilesView(session, app);
    await openTreeRowMenu(session, 'collision-replacement.txt');
    await clickMenuItem(session, app, 'Rename');
    await session.waitForBodyText('Rename', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'collision.txt');
    await waitForDisk(
      () =>
        fs.existsSync(path.join(workspace, 'collision.txt')) &&
        !fs.existsSync(path.join(workspace, 'collision-replacement.txt')),
      'replacement collision file renamed through the app before restore',
      20_000,
    );
    await activateTrashView(session, app);
    await session.waitForBodyText('collision.txt', { timeoutMs: 15_000 });
    await clickTrashRowAction(session, 'collision.txt', 'Restore');
    let restoredCollision;
    try {
      restoredCollision = await waitForDisk(() => {
        const candidates = fs
          .readdirSync(workspace)
          .filter((name) => /^collision_restored_\d+\.txt$/.test(name));
        return candidates.length > 0 ? candidates[0] : null;
      }, 'collision restore created a unique restored copy', 12_000);
    } catch {
      const originalContent = fs.existsSync(path.join(workspace, 'collision.txt'))
        ? fs.readFileSync(path.join(workspace, 'collision.txt'), 'utf8').trim()
        : '<missing>';
      throw new Error(
        `BLOCKED: needs product fix for Trash restore collision; restoring collision.txt while collision.txt already exists leaves no collision_restored_*.txt copy (original="${originalContent}", trashPayloadStillExists=${String(fs.existsSync(collisionEntry.trashPath))}, metadataStillHasEntry=${String(Boolean(trashEntryFor(workspace, 'collision.txt')))})`,
      );
    }
    if (fs.readFileSync(path.join(workspace, 'collision.txt'), 'utf8') !== 'replacement collision\n') {
      throw new Error('Restore collision overwrote the replacement original file');
    }
    if (!fs.readFileSync(path.join(workspace, restoredCollision), 'utf8').includes('original collision')) {
      throw new Error('Restore collision copy did not preserve the trashed file content');
    }
    if (fs.existsSync(collisionEntry.trashPath) || trashEntryFor(workspace, 'collision.txt')) {
      throw new Error('collision.txt still has a trash payload or metadata entry after collision restore');
    }
  },
};
