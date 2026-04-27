import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shot01 } from './shots/01-workspace-hero';
import { shot02 } from './shots/02-ai-chat';
import { shot03 } from './shots/03-wikilinks';
import { shot04 } from './shots/04-templates';
// shot05 deferred — no import
import { shot06 } from './shots/06-api-keys';
import { reframeAll } from './shots/07-09-social-reframes';
import { shot10 } from './shots/10-document-suite';
import { shot11 } from './shots/11-local-first';
import { video01 } from './videos/01-demo-30s';
import { video02 } from './videos/02-workspace-tour';
import { video03 } from './videos/03-wikilinks';
import { video04 } from './videos/04-workflow-templates';
import { video05 } from './videos/05-document-suite';
import { video06 } from './videos/06-byok-setup';
import { video07 } from './videos/07-local-first';
import { video08 } from './videos/08-version-history';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJELLI_ROOT = path.resolve(HERE, '../../');

function preflight(): void {
  const fonts = execFileSync('fc-list', [':family'], { encoding: 'utf-8' });
  if (!/SF Pro/i.test(fonts)) {
    throw new Error('SF Pro fonts not installed. See SPEC § Mac-styling layer.');
  }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { throw new Error('ffmpeg not installed (apt install ffmpeg).'); }
  console.log('✓ preflight: fonts + ffmpeg present');
}

interface DevServer { kill: () => void; }

async function startDevServer(): Promise<DevServer> {
  const proc: ChildProcess = spawn('npm', ['run', 'dev'], {
    cwd: PROJELLI_ROOT,
    env: { ...process.env, VITE_MARKETING_CAPTURE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server timeout')), 90_000);
    proc.stdout?.on('data', (b: Buffer) => {
      if (b.toString().includes('localhost:5173')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr?.on('data', (b: Buffer) => {
      // forward fatal errors only — dev server is chatty
      const s = b.toString();
      if (s.includes('Error') && s.includes('EADDRINUSE')) reject(new Error('port 5173 in use'));
    });
  });
  await sleep(2000);
  return { kill: () => proc.kill('SIGTERM') };
}

async function main() {
  const start = Date.now();
  preflight();

  // Detect if a dev server is already running on 5173
  let dev: DevServer | null = null;
  try {
    execFileSync('curl', ['-fsS', 'http://localhost:5173/', '-o', '/dev/null'], { stdio: 'ignore' });
    console.log('✓ dev server already running on :5173, reusing');
  } catch {
    console.log('Starting dev server...');
    dev = await startDevServer();
    console.log('✓ dev server up');
  }

  try {
    console.log('--- Tier 1 (press kit) ---');
    await shot01(); console.log('✓ S01 workspace hero');
    await shot02(); console.log('✓ S02 AI mid-stream');
    await shot03(); console.log('✓ S03 wiki-links');
    await shot04(); console.log('✓ S04 templates');
    // S05 deferred (multi-model UI not yet built)
    await shot06(); console.log('✓ S06 API keys');

    console.log('--- Tier 2 (launch channels) ---');
    await reframeAll();          console.log('✓ S07/S08/S09 social reframes');
    await shot10();              console.log('✓ S10 document suite');
    await shot11();              console.log('✓ S11 local-first');

    console.log('--- Videos ---');
    await video01(); console.log('✓ V01 30-second demo');
    await video02(); console.log('✓ V02 workspace tour');
    await video03(); console.log('✓ V03 wiki-links');
    await video04(); console.log('✓ V04 workflow templates');
    await video05(); console.log('✓ V05 document suite');
    await video06(); console.log('✓ V06 BYOK setup');
    await video07(); console.log('✓ V07 local-first');
    await video08(); console.log('✓ V08 version history');
  } finally {
    if (dev) {
      dev.kill();
      console.log('✓ dev server stopped');
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nLibrary built in ${elapsed}s.`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
