#!/usr/bin/env node
// create-keepance-plugin
//
// Scaffolds a new Keepance plugin from the bundled template. Designed to be
// run via `npx create-keepance-plugin <name>` or, in the monorepo, directly
// with `node bin/create.js <name>`.
//
// Surface (intentionally small, no external deps):
//   <name>          required positional, becomes the directory + plugin id
//   --no-install    skip the automatic `npm install` step
//   --force         overwrite a non-empty target directory
//   --help          print usage

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, '..', 'template');

function printUsage() {
  process.stdout.write(
    [
      'Usage: create-keepance-plugin <name> [options]',
      '',
      'Arguments:',
      '  <name>          Required. Directory name and default plugin id.',
      '                  Must match /^[a-z0-9][a-z0-9-]*$/.',
      '',
      'Options:',
      '  --no-install    Skip the automatic `npm install` step.',
      '  --force         Overwrite an existing non-empty target directory.',
      '  --help, -h      Print this message.',
      '',
      'Example:',
      '  npx create-keepance-plugin my-plugin',
      '',
    ].join('\n'),
  );
}

function fail(msg) {
  process.stderr.write(`create-keepance-plugin: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { name: null, install: true, force: false, help: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--no-install') args.install = false;
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length > 1) fail('too many positional arguments');
  args.name = positional[0] ?? null;
  return args;
}

function validateName(name) {
  if (!name) fail('missing required <name> argument. Run with --help for usage.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(
      `invalid name "${name}". Must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens.`,
    );
  }
}

function ensureTargetDir(target, force) {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    return;
  }
  const stat = statSync(target);
  if (!stat.isDirectory()) fail(`target exists and is not a directory: ${target}`);
  const entries = readdirSync(target);
  if (entries.length > 0 && !force) {
    fail(`target directory is not empty: ${target}. Use --force to overwrite.`);
  }
}

// Recursively copy a directory tree, applying placeholder substitution to
// text files. Skips dotfiles starting with `_template` (none currently, but
// reserved).
function copyTree(srcDir, dstDir, replacements) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const dstPath = join(dstDir, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyTree(srcPath, dstPath, replacements);
      continue;
    }
    if (isBinary(entry)) {
      copyFileSync(srcPath, dstPath);
      continue;
    }
    let contents = readFileSync(srcPath, 'utf8');
    for (const [key, value] of Object.entries(replacements)) {
      contents = contents.split(key).join(value);
    }
    writeFileSync(dstPath, contents, 'utf8');
  }
}

function isBinary(filename) {
  // Template currently contains only text files. Reserve common binary
  // extensions so future template additions don't get corrupted.
  return /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|zip|gz|tgz)$/i.test(filename);
}

function runNpmInstall(target) {
  const result = spawnSync('npm', ['install'], {
    cwd: target,
    stdio: 'inherit',
  });
  return result.status === 0;
}

function printNextSteps(name, dirRelative, installed) {
  const lines = [
    '',
    `  Scaffolded ${name} at ${dirRelative}`,
    '',
    '  Next steps:',
    `    cd ${dirRelative}`,
  ];
  if (!installed) {
    lines.push('    npm install');
  }
  lines.push(
    '    npm run build',
    '',
    '  Then drop manifest.json plus dist/index.js into your local',
    '  Keepance plugins folder for sideloading. See:',
    '    https://keepance.com/docs/plugins/getting-started',
    '',
  );
  process.stdout.write(lines.join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  validateName(args.name);

  const target = resolve(process.cwd(), args.name);
  ensureTargetDir(target, args.force);

  const replacements = {
    __PLUGIN_ID__: args.name,
    __PLUGIN_NAME__: args.name
      .split('-')
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
      .join(' '),
    __PLUGIN_AUTHOR__: 'Plugin Author',
  };

  copyTree(TEMPLATE_DIR, target, replacements);

  let installed = false;
  if (args.install) {
    installed = runNpmInstall(target);
    if (!installed) {
      process.stderr.write(
        'create-keepance-plugin: npm install failed. You can re-run it manually.\n',
      );
    }
  }

  printNextSteps(basename(target), args.name, installed);
}

main();
