import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');

test('control-day override is unsigned NSIS-only without changing normal release config', () => {
  const base = JSON.parse(read('src-tauri/tauri.conf.json')),
    over = JSON.parse(read('src-tauri/tauri.control-day-unsigned.conf.json'));
  assert.deepEqual(over.bundle.targets, ['nsis']);
  assert.equal(over.bundle.createUpdaterArtifacts, false);
  assert.equal(over.bundle.windows.signCommand, null);
  assert.equal(base.bundle.createUpdaterArtifacts, true);
  assert.ok(base.bundle.targets.length > 1);
});
test('both release jobs map existing secrets to the names compiled by Lantern', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.equal(
    (
      workflow.match(
        /LANTERN_GMAIL_CLIENT_ID: \$\{\{ secrets\.KEEPANCE_GMAIL_CLIENT_ID \}\}/g
      ) || []
    ).length,
    2
  );
  assert.equal(
    (
      workflow.match(
        /LANTERN_GMAIL_CLIENT_SECRET: \$\{\{ secrets\.KEEPANCE_GMAIL_CLIENT_SECRET \}\}/g
      ) || []
    ).length,
    2
  );
  assert.doesNotMatch(workflow, /^\s+KEEPANCE_GMAIL_CLIENT_(?:ID|SECRET):/m);
});
test('orchestrator contains the complete fixed Windows recipe and never records secret values', () => {
  const script = read('scripts/windows-final-build/build.ps1');
  for (const needle of [
    'C:\\APH-Final-Builds',
    "@('ci','--ignore-scripts')",
    'copy-build-assets.mjs',
    'fetch-piper-sidecar.sh',
    'fetch-llama-sidecar.sh',
    'stage-meeting-voice-sidecars.sh',
    "'--bin','lantern-mcp'",
    'lantern-windows.mcpb',
    'Remove-Item -LiteralPath $rawMcp',
    "@('run','build')",
    "'--bin','lantern'",
    'prepare-config.mjs',
    'inventory-list',
    'guard-list',
    "'tauri','build','--bundles','nsis'",
    'Get-AuthenticodeSignature',
    'reconcile-payload.mjs',
    'signature_status=$signature',
    'payloadExe[0].sha256-cne $x',
    'guarded)-cne (Hash $after)',
  ])
    assert.ok(script.includes(needle), needle);
  assert.doesNotMatch(
    script,
    /LANTERN_GMAIL_CLIENT_(?:ID|SECRET)\s*[:=].*(Hash|Length|Substring)/i
  );
});
test('resolved packager config forbids broad globs, wrong targets, loose MCP, and requires every family', () => {
  const prep = read('scripts/windows-final-build/prepare-config.mjs');
  assert.doesNotMatch(
    read('src-tauri/tauri.control-day-unsigned.conf.json'),
    /\*\*/
  );
  for (const needle of [
    'ggml-tiny',
    'ggml-base',
    'segmentation',
    'embedding',
    'lantern-diarize',
    'sherpa-onnx',
    'onnxruntime',
    'lantern-windows',
    'loose MCP executable forbidden',
    'wrong-target',
    'unexplained staged input',
  ])
    assert.ok(prep.includes(needle), needle);
});
test('native recorder uses no-follow handles and rejects links, streams, aliases, and swaps', () => {
  const source = read('scripts/windows-final-build/Recorder.cs');
  for (const needle of [
    'OPEN_REPARSE',
    'FILE_ATTRIBUTE_REPARSE_POINT',
    'links!=1',
    'FindFirstStreamW',
    'alternate stream forbidden',
    'case/NFC collision',
    'file changed while hashing',
    'CreateFileW',
  ])
    assert.ok(source.includes(needle), needle);
});
test('consumer-side payload reconciliation rejects every unexplained file and loose MCP executable', () => {
  const source = read('scripts/windows-final-build/reconcile-payload.mjs');
  for (const needle of [
    'unexplained extracted payload file',
    'payload hash mismatch',
    'expected payload file absent',
    'pinned NSIS generated input absent',
    'raw lantern-mcp executable escaped',
  ])
    assert.ok(source.includes(needle), needle);
});
test('producer records measurements but supplies no counts or acceptance size policy', () => {
  const contract = read('scripts/windows-final-build/contract.mjs');
  assert.doesNotMatch(
    contract,
    /1_073_741_824|134_217_728|input_count|accepted_paths/
  );
  assert.match(
    read('scripts/windows-final-build/build.ps1'),
    /verified_uncompressed_payload_bytes/
  );
});
