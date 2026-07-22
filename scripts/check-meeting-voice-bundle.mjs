#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WINDOWS_MEETING_CLOSURE = [
  'src-tauri/binaries/whisper.exe',
  'src-tauri/binaries/diarize/lantern-diarize.exe',
  'src-tauri/resources/voice/models/ggml-tiny.en.bin',
  'src-tauri/resources/voice/models/ggml-base.en.bin',
  'src-tauri/resources/diarize/segmentation.onnx',
  'src-tauri/resources/diarize/embedding.onnx',
];
export function checkClosure(root, files) {
  const failures = [];
  for (const rel of WINDOWS_MEETING_CLOSURE)
    if (!files.includes(rel) || fs.statSync(path.join(root, rel)).size <= 0)
      failures.push(`missing or empty: ${rel}`);
  if (
    !files.some((p) =>
      /^src-tauri\/binaries\/diarize\/.*sherpa-onnx-c-api\.dll$/.test(p)
    )
  )
    failures.push('missing diarization sherpa DLL');
  if (
    !files.some((p) =>
      /^src-tauri\/binaries\/diarize\/.*onnxruntime.*\.dll$/.test(p)
    )
  )
    failures.push('missing diarization ONNX Runtime DLL');
  return failures;
}
const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const scripts =
  JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts ?? {};
const failures = [];
for (const resource of ['resources/**/*', 'binaries/**/*'])
  if (!config.bundle?.resources?.includes(resource))
    failures.push(`normal tauri config lost ${resource}`);
if (
  scripts['stage-meeting-voice-sidecars'] !==
  'bash scripts/stage-meeting-voice-sidecars.sh'
)
  failures.push('package.json must expose stage-meeting-voice-sidecars');
for (const file of [
  'scripts/stage-meeting-voice-sidecars.sh',
  'scripts/fetch-voice-models.sh',
  'scripts/fetch-diarize-models.sh',
  'scripts/build-voice-sidecar.sh',
  'scripts/build-diarize-sidecar.sh',
])
  if (!fs.existsSync(file)) failures.push(`missing staging source: ${file}`);
const real = WINDOWS_MEETING_CLOSURE.every((p) => fs.existsSync(p));
let fixtureRoot = process.cwd(),
  files = [];
if (real) {
  files = fs
    .readdirSync('src-tauri/binaries/diarize')
    .map((n) => `src-tauri/binaries/diarize/${n}`);
  files.push(...WINDOWS_MEETING_CLOSURE);
} else {
  fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lantern-meeting-closure-')
  );
  files = [
    ...WINDOWS_MEETING_CLOSURE,
    'src-tauri/binaries/diarize/sherpa-onnx-c-api.dll',
    'src-tauri/binaries/diarize/onnxruntime.dll',
  ];
  for (const rel of files) {
    const full = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'synthetic-only');
  }
}
failures.push(...checkClosure(fixtureRoot, files));
if (!real) fs.rmSync(fixtureRoot, { recursive: true, force: true });
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Meeting package closure passed (${real ? 'real staged assets' : 'complete synthetic fixture; no assets staged'}).`
);
