#!/usr/bin/env node
/**
 * deploy-demo-workspace.mjs — copies the fictional advisor sample workspace
 * (docs/demo/sample-workspace/) to a target folder, so a bench/VM (e.g. the
 * Legion Windows box or a cloud demo VM) can open it as a pre-existing
 * client-files folder. This also doubles as the QA-92 regression asset:
 * the files exist on disk BEFORE the app ever touches the folder.
 *
 * Usage:
 *   node scripts/deploy-demo-workspace.mjs [targetPath]
 *
 * Defaults to ~/Documents/Beacon Ridge Wealth Advisors if no target is given.
 * The generator script itself (generate_workspace.py) and this deploy
 * script are never copied — only the client folders.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'docs', 'demo', 'sample-workspace');
const DEFAULT_TARGET = join(homedir(), 'Documents', 'Beacon Ridge Wealth Advisors');

const target = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_TARGET;

if (!existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  process.exit(1);
}

// Only ever deploy client folders — never the generator script or this
// script itself, in case someone points the target at the repo by mistake.
const CLIENT_FOLDERS = readdirSync(SOURCE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (CLIENT_FOLDERS.length === 0) {
  console.error(`No client folders found in ${SOURCE}. Run generate_workspace.py first.`);
  process.exit(1);
}

if (existsSync(target)) {
  console.log(`Target already exists, removing: ${target}`);
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });

for (const folder of CLIENT_FOLDERS) {
  cpSync(join(SOURCE, folder), join(target, folder), { recursive: true });
  console.log(`  copied ${folder}`);
}

console.log(`\nDeployed ${CLIENT_FOLDERS.length} client folder(s) to: ${target}`);
console.log('Open this folder as the workspace in the app to run the demo.');
