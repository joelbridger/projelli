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

async function clickButtonText(session, app, text, timeoutMs = 15_000) {
  const button = await session.find(
    'xpath',
    `//button[normalize-space()=${app.xpathLiteral(text)}]`,
    timeoutMs,
  );
  await session.click(button);
}

async function fillPrompt(session, app, value, confirmText = 'OK') {
  const input = await session.find('xpath', '//div[@role="dialog"]//input', 15_000);
  await session.clear(input);
  await session.type(input, value);
  await clickButtonText(session, app, confirmText, 10_000);
}

async function activateFilesTab(session, app) {
  const filesTab = await session.find(
    'xpath',
    `//*[@role="tablist"]//button[normalize-space()=${app.xpathLiteral('Files')}]`,
    15_000,
  );
  await session.click(filesTab);
  await session.testid('documents-toolbar', 15_000);
}

async function openGridFolder(session, app, folderName) {
  const folder = await session.find(
    'xpath',
    `//button[.//span[normalize-space()=${app.xpathLiteral(folderName)}]]`,
    15_000,
  );
  await session.click(folder);
  await session.waitForBodyText('All files', { timeoutMs: 15_000 });
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

async function ensureTreeRowVisible(session, fileName, ancestorName) {
  const isVisible = await session.execute(
    `
      const name = arguments[0];
      return Array.from(document.querySelectorAll('[role="treeitem"]'))
        .some((el) => (el.textContent || '').includes(name));
    `,
    [fileName],
  );
  if (isVisible) return;
  await clickTreeRow(session, ancestorName);
  await session.waitForBodyText(fileName, { timeoutMs: 15_000 });
}

async function clickTreeRow(session, fileName) {
  const clicked = await session.execute(
    `
      const name = arguments[0];
      const rows = Array.from(document.querySelectorAll('[role="treeitem"]'));
      const row = rows.find((el) => (el.textContent || '').includes(name));
      if (!row) return false;
      row.click();
      return true;
    `,
    [fileName],
  );
  if (!clicked) throw new Error(`Could not click file-tree row for ${fileName}`);
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

async function typeIntoCodeMirror(session, text) {
  const editor = await session.find('css selector', '.cm-content', 15_000);
  await session.click(editor);
  await session.type(editor, text);
}

export default {
  name: '10-files-editor',
  async run({ session, workspace, app }) {
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'switch-target.txt'), 'Second tab target\n');

    await app.bootToWorkspace(session, { workspacePath: workspace });
    await app.gotoSurface(session, 'Documents');
    await session.testid('documents-toolbar', 15_000);
    await session.testid('documents-tab-strip', 15_000);

    // Create the canonical Word document through the real toolbar prompt.
    await clickButtonText(session, app, 'New document');
    await session.waitForBodyText('Create Word Document', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'Layer 2 Word');
    const docxPath = path.join(workspace, 'docs', 'Layer 2 Word.docx');
    await waitForDisk(() => fs.existsSync(docxPath) && fs.statSync(docxPath).size > 0, 'created .docx on disk');
    await session.waitForBodyText('Layer 2 Word.docx', { timeoutMs: 20_000 });
    if (!(await session.hasTestid('docx-editor', 30_000))) {
      throw new Error('Created .docx did not open in the OOXML editor');
    }

    // Create a folder, then create a markdown file inside it from the tree row menu.
    await activateFilesTab(session, app);
    // The current Documents toolbar creates inside the active folder context.
    // Drill into the real `docs` folder so the on-disk target is explicit.
    await openGridFolder(session, app, 'docs');
    await clickButtonText(session, app, 'New folder');
    await session.waitForBodyText('Create Folder', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'L2 Folder');
    const folderPath = path.join(workspace, 'docs', 'L2 Folder');
    await waitForDisk(() => fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory(), 'created folder on disk');
    await session.waitForBodyText('L2 Folder', { timeoutMs: 15_000 });

    await session.clickTestid('docs-view-tree', 15_000);
    await ensureTreeRowVisible(session, 'L2 Folder', 'docs');
    await openTreeRowMenu(session, 'L2 Folder');
    await clickMenuItem(session, app, 'New File');
    await session.waitForBodyText('Create File', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'notes.md');
    const mdPath = path.join(folderPath, 'notes.md');
    await waitForDisk(() => fs.existsSync(mdPath), 'created markdown file on disk');
    await session.waitForBodyText('notes.md', { timeoutMs: 15_000 });

    // Edit the markdown file and verify autosave persisted the text to the real workspace.
    const markdownText = '# Autosaved note\nThis text came from the desktop Layer 2 spec.\n';
    await typeIntoCodeMirror(session, markdownText);
    await session.testid('auto-save-indicator', 10_000);
    await waitForDisk(
      () => fs.readFileSync(mdPath, 'utf8').includes('Layer 2 spec'),
      'autosaved markdown content on disk',
      25_000,
    );
    await session.waitForBodyText('Saved', { timeoutMs: 20_000 });

    // Version history is localStorage-backed for text files; open the real panel and assert versions exist.
    await session.clickTestid('toolbar-overflow', 15_000);
    await session.clickTestid('toolbar-history', 10_000);
    await session.waitForBodyText('Version History', { timeoutMs: 15_000 });
    await session.waitForBodyText('Latest', { timeoutMs: 15_000 });
    await session.waitForBodyText('Auto-saved version', { timeoutMs: 15_000 });

    // Rename the file through the row overflow and verify the path/content moved on disk.
    await activateFilesTab(session, app);
    await session.clickTestid('docs-view-tree', 15_000);
    await openTreeRowMenu(session, 'notes.md');
    await clickMenuItem(session, app, 'Rename');
    await session.waitForBodyText('Rename', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'renamed-notes.md');
    const renamedMdPath = path.join(folderPath, 'renamed-notes.md');
    await waitForDisk(
      () => fs.existsSync(renamedMdPath) && !fs.existsSync(mdPath),
      'renamed markdown path on disk',
    );
    if (!fs.readFileSync(renamedMdPath, 'utf8').includes('Layer 2 spec')) {
      throw new Error('Renamed markdown file lost its autosaved content');
    }
    await session.waitForBodyText('renamed-notes.md', { timeoutMs: 15_000 });

    // Switch tabs between the renamed markdown file and an existing text file.
    await openTreeRowMenu(session, 'switch-target.txt');
    await clickMenuItem(session, app, 'Rename');
    await session.waitForBodyText('Rename', { timeoutMs: 15_000 });
    await fillPrompt(session, app, 'switch-target-renamed.txt');
    const txtPath = path.join(workspace, 'switch-target-renamed.txt');
    await waitForDisk(() => fs.existsSync(txtPath), 'renamed switch-target text file on disk');

    await activateFilesTab(session, app);
    await session.clickTestid('docs-view-tree', 15_000);
    await clickTreeRow(session, 'switch-target-renamed.txt');
    await session.waitForBodyText('switch-target-renamed.txt', { timeoutMs: 15_000 });
    await session.waitForBodyText('Second tab target', { timeoutMs: 15_000 });

    const mdTab = await session.find(
      'xpath',
      `//*[@role="tablist"]//button[normalize-space()=${app.xpathLiteral('notes.md')}]`,
      15_000,
    );
    await session.click(mdTab);
    await session.waitForBodyText('Layer 2 spec', { timeoutMs: 15_000 });

    const txtTab = await session.find(
      'xpath',
      `//*[@role="tablist"]//button[normalize-space()=${app.xpathLiteral('switch-target-renamed.txt')}]`,
      15_000,
    );
    await session.click(txtTab);
    await session.waitForBodyText('Second tab target', { timeoutMs: 15_000 });
  },
};
