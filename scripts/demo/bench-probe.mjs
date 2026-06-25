// Probe bench app state: page url, workspace/matters, email connection status.
import { getPage } from '../robot/connection.mjs';

const page = await getPage();
const url = page.url();
const out = await page.evaluate(() => {
  const r = { href: location.href };
  try {
    const m = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
    const arr = m.state ? m.state.matters : m.matters;
    r.matters = (arr || []).length;
  } catch (e) { r.matters = 'err'; }
  // hunt for any email-connection localStorage keys
  r.emailKeys = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/mail|email|connect|account|graph|m365|microsoft|oauth/i.test(k)) {
      r.emailKeys[k] = (localStorage.getItem(k) || '').slice(0, 200);
    }
  }
  r.bodyHasNorthcrest = document.body.innerText.includes('Northcrest');
  r.workspacePickerVisible = /Open a workspace|Recent workspaces|Choose a folder/i.test(document.body.innerText);
  return r;
});
console.log('PAGE URL:', url);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
