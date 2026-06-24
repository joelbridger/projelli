// scripts/robot/artifacts.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function attachConsoleAndNetwork(page) {
  const buffers = { console: [], requests: [] };
  page.on('console', (m) => buffers.console.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  page.on('requestfinished', (r) => buffers.requests.push(`${r.method()} ${r.url()}`.slice(0, 300)));
  return buffers;
}

export async function captureBundle(page, { dir, label, buffers = { console: [], requests: [] }, extra = null }) {
  mkdirSync(dir, { recursive: true });
  const written = [];
  const shot = path.join(dir, `${label}.jpeg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 80 }).then(() => written.push(shot)).catch(() => {});
  const dom = await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText).catch(() => '');
  const domPath = path.join(dir, `${label}.dom.txt`); writeFileSync(domPath, dom.slice(0, 20000)); written.push(domPath);
  const cPath = path.join(dir, `${label}.console.log`); writeFileSync(cPath, buffers.console.slice(-200).join('\n')); written.push(cPath);
  const nPath = path.join(dir, `${label}.network.log`); writeFileSync(nPath, buffers.requests.slice(-200).join('\n')); written.push(nPath);
  if (extra) { const ePath = path.join(dir, `${label}.extra.json`); writeFileSync(ePath, JSON.stringify(extra, null, 2)); written.push(ePath); }
  return written;
}
