// QA-81 baseline crash-repro — fully self-contained, single process, explicit
// exit at the end (no lingering zombies). Creates a brand-new client + fresh
// .docx, types real keyboard content, kills lantern.exe from WITHIN this same
// process (deterministic timing, no separate SSH round trip), then reads the
// on-disk .docx directly via PowerShell's System.IO.Compression (no UI, no
// CDP needed for this check) to see if the typed marker actually landed.
import { getPage } from './robot/connection.mjs';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CLIENT_NAME = 'QA81 Crash Repro ' + Math.floor(Math.random() * 100000);
const MARKER = 'QA81-CRASH-MARKER-' + Math.floor(Math.random() * 1000000);
const WORKSPACE_ROOT = 'C:\\Users\\lpbench\\Documents\\QA Workspace';

async function clickTestid(page, testid) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) { el.click(); return true; }
    return false;
  }, testid);
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function readDocxText(path) {
  // Reads word/document.xml out of the .docx (a zip) via .NET, no Node deps needed.
  const ps = `
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead(${psQuote(path)})
  $entry = $zip.GetEntry('word/document.xml')
  if (-not $entry) { Write-Output 'NO_ENTRY'; exit 0 }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  $text = $reader.ReadToEnd()
  $zip.Dispose()
  Write-Output $text
} catch {
  Write-Output ('ERROR: ' + $_.Exception.Message)
}
`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return out;
  } catch (e) {
    return 'EXEC_ERROR: ' + e.message;
  }
}

function statFile(path) {
  try {
    const s = fs.statSync(path);
    return { exists: true, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false };
  }
}

const page = await getPage();

for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }

// Create a brand-new client.
await clickTestid(page, 'spine-nav-matters');
await page.waitForTimeout(600);
await clickTestid(page, 'spine-new-client');
await page.waitForTimeout(600);
await page.fill('[data-testid="matter-new-name"]', CLIENT_NAME);
await page.click('[data-testid="matter-create-button"]');
await page.waitForTimeout(1000);
// Close the client-manager dialog (last button in the dialog is the X close).
await page.evaluate(() => {
  const dlg = document.querySelector('[data-testid="matter-manager-dialog"]');
  if (!dlg) return;
  const btns = dlg.querySelectorAll('button');
  btns[btns.length - 1].click();
});
await page.waitForTimeout(600);

// Open the new client via its Client Map row.
const opened = await page.evaluate((name) => {
  const rows = Array.from(document.querySelectorAll('[data-testid^="matter-row-"]'));
  const row = rows.find((r) => r.textContent && r.textContent.includes(name));
  if (row) { row.click(); return true; }
  return false;
}, CLIENT_NAME);
await page.waitForTimeout(800);
await clickTestid(page, 'hub-subtab-documents');
await page.waitForTimeout(800);

// Create a fresh Word document named after our marker.
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'New document');
  if (b) b.click();
});
await page.waitForTimeout(800);
const fileBase = 'qa81-doc-' + Math.floor(Math.random() * 100000);
await page.fill('input', fileBase);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'OK');
  if (b) b.click();
});
await page.waitForTimeout(1500);

const docPath = `${WORKSPACE_ROOT}\\${CLIENT_NAME}\\${fileBase}.docx`;

// Find a clickable point inside the (currently empty) editor and type real keystrokes.
// For a brand-new empty doc, the contenteditable itself can be 0-height, so walk
// up to the first visible ancestor with real width/height and click inside it.
let clickPoint = null;
for (let i = 0; i < 6 && !clickPoint; i++) {
  await page.waitForTimeout(500);
  clickPoint = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="docx-editor"]');
    if (!root) return null;
    let el = root.querySelector('[contenteditable="true"]') || root;
    for (let depth = 0; depth < 6 && el; depth++) {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) return { x: r.left + 25, y: r.top + 25 };
      el = el.parentElement;
    }
    return null;
  });
}
if (!clickPoint) {
  console.log(JSON.stringify({ error: 'could not find a click point in the fresh editor', docPath }));
  process.exit(1);
}

await page.mouse.click(clickPoint.x, clickPoint.y);
await page.waitForTimeout(300);
await page.keyboard.type(MARKER, { delay: 25 });
await page.waitForTimeout(500);

const domTextAfterType = await page.evaluate(() => document.querySelector('[data-testid="docx-editor"]')?.innerText || null);
const saveStateAfterType = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="auto-save-indicator"]');
  return el ? { state: el.getAttribute('data-state'), label: el.innerText } : null;
});

const statBeforeKill = statFile(docPath);

// Do NOT navigate away. Kill the app right now, simulating a crash.
await new Promise((resolve, reject) => {
  const killer = spawn('powershell', ['-NoProfile', '-Command', 'Stop-Process -Name lantern -Force -ErrorAction SilentlyContinue'], { stdio: 'ignore' });
  killer.on('close', resolve);
  killer.on('error', reject);
});
await new Promise((r) => setTimeout(r, 2000));

const statAfterKill = statFile(docPath);
const docxXmlAfterKill = readDocxText(docPath);
const markerSurvived = docxXmlAfterKill.includes(MARKER);

console.log(JSON.stringify({
  clientName: CLIENT_NAME,
  fileBase,
  docPath,
  marker: MARKER,
  domTextAfterType,
  saveStateAfterType,
  statBeforeKill,
  statAfterKill,
  markerSurvived,
  docxXmlSnippet: docxXmlAfterKill.slice(0, 200),
}, null, 2));

process.exit(0);
