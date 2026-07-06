// Tag each imported client email to its matching demo matter (in-place RAG retag),
// so opening a client + asking (email scope) reliably finds THAT client's email.
import { getPage } from '../robot/connection.mjs';
import { matchMatterIdForSender } from './email-matter-matching.mjs';
const page = await getPage();

const data = await page.evaluate(async () => {
  const r = await window.__TAURI__.core.invoke('mail_list_messages', { query: { sortBy: 'date', sortDesc: true, limit: 100, offset: 0 } });
  const items = (r.items || []).map((m) => ({ id: m.id, fromName: m.fromName, fromAddr: m.fromAddr, subject: m.subject }));
  const mm = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
  const matters = ((mm.state ? mm.state.matters : mm.matters) || []).map((x) => ({ id: x.id, name: x.name || x.title || '' }));
  return { items, matters };
});

const plan = data.items
  .filter((m) => /jamesondaines\.com/.test(m.fromAddr)) // only the demo client emails
  .map((m) => ({ ...m, matterId: matchMatterIdForSender(m.fromName, data.matters) }));

console.log('messages (client demo emails):', plan.length);
const matched = plan.filter((p) => p.matterId);
const unmatched = plan.filter((p) => !p.matterId);
console.log('matched:', matched.length, '| unmatched:', unmatched.length);
unmatched.forEach((u) => console.log('  UNMATCHED:', u.fromName, '|', u.subject));

// retag matched ones
let ok = 0;
for (const p of matched) {
  try {
    await page.evaluate(async (args) => { await window.__TAURI__.core.invoke('mail_retag_message_matter', { messageId: args.id, matterId: args.matterId }); }, p);
    console.log('  tagged', p.fromName.padEnd(22), '->', p.matterId);
    ok++;
  } catch (e) { console.log('  ERR', p.fromName, String(e).slice(0, 80)); }
}
console.log(`\nTAGGED ${ok}/${matched.length}`);
process.exit(0);
