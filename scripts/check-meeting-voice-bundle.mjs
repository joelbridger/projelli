#!/usr/bin/env node
/**
 * Prevent the meeting voice bundle from becoming an undocumented manual step.
 * The scripts build the two executables and checksum-verify their models;
 * Tauri's resource globs are what carry all of those staged files into an
 * installer.
 */
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts ?? {};
const resources = config.bundle?.resources ?? [];

const failures = [];
for (const resource of ['resources/**/*', 'binaries/**/*']) {
  if (!resources.includes(resource)) failures.push(`tauri bundle.resources must include ${resource}`);
}
if (scripts['stage-meeting-voice-sidecars'] !== 'bash scripts/stage-meeting-voice-sidecars.sh') {
  failures.push('package.json must expose stage-meeting-voice-sidecars');
}
for (const file of [
  'scripts/stage-meeting-voice-sidecars.sh',
  'scripts/fetch-voice-models.sh',
  'scripts/fetch-diarize-models.sh',
  'scripts/build-voice-sidecar.sh',
  'scripts/build-diarize-sidecar.sh',
]) {
  if (!fs.existsSync(file)) failures.push(`required meeting-voice staging file is missing: ${file}`);
}

if (failures.length) {
  console.error('Meeting voice bundle check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Meeting voice bundle check passed.');
