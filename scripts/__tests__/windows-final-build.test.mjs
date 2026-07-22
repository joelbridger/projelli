import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildZip } from '../build-mcpb.mjs';
import { canonical } from '../windows-final-build/contract.mjs';
import { verifySourceArchive } from '../windows-final-build/archive.mjs';
import { validateMcpbBytes } from '../windows-final-build/validate-mcpb.mjs';

const read = (p) => fs.readFileSync(p, 'utf8');
const gitHash = (type, bytes) =>
  createHash('sha1')
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
function sourceFixture() {
  const content = new Map([
    [
      'hook.mjs',
      Buffer.from(
        "import fs from 'node:fs';fs.writeFileSync('PREVALIDATION-RAN','bad');\n"
      ),
    ],
    [
      'package.json',
      Buffer.from('{"scripts":{"preinstall":"node hook.mjs"}}\n'),
    ],
  ]);
  const files = [...content].map(([filePath, bytes]) => ({
    mode: '100644',
    type: 'blob',
    blob: gitHash('blob', bytes),
    bytes: bytes.length,
    path: filePath,
  }));
  files.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
  );
  const treeBody = Buffer.concat(
    files.map((file) =>
      Buffer.concat([
        Buffer.from(`${file.mode} ${file.path}\0`),
        Buffer.from(file.blob, 'hex'),
      ])
    )
  );
  const tree = gitHash('tree', treeBody);
  const commitBytes = Buffer.from(
    `tree ${tree}\nauthor Fixture <fixture@example.test> 0 +0000\ncommitter Fixture <fixture@example.test> 0 +0000\n\nfixture\n`
  );
  const commit = gitHash('commit', commitBytes);
  const manifest = {
    schema: 1,
    commit,
    tree,
    commit_object_base64: commitBytes.toString('base64'),
    files,
  };
  const archive = buildZip(
    [...content].map(([filePath, bytes]) => ({
      path: filePath,
      content: bytes,
      mode: 0o100644,
    }))
  );
  return { archive, manifest, content };
}
function mcpbFixture(binary = Buffer.from('MZ-real-windows-mcp')) {
  const manifest = {
    dxt_version: '0.1',
    name: 'lantern',
    server: {
      type: 'binary',
      entry_point: 'server/lantern-mcp.exe',
      mcp_config: { command: '${__dirname}/server/lantern-mcp.exe' },
    },
    compatibility: { platforms: ['x86_64-pc-windows-msvc'] },
  };
  return {
    binary,
    archive: buildZip([
      { path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest)) },
      { path: 'server/lantern-mcp.exe', content: binary, mode: 0o100755 },
    ]),
  };
}

test('source archive is fully Git-bound before a package hook can execute', () => {
  const fixture = sourceFixture(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-proof-')),
    destination = path.join(root, 'private');
  const receipt = verifySourceArchive({
    archiveBytes: fixture.archive,
    manifestBytes: Buffer.from(canonical(fixture.manifest)),
    destination,
  });
  assert.equal(receipt.commit, fixture.manifest.commit);
  assert.equal(receipt.tree, fixture.manifest.tree);
  assert.equal(
    fs.existsSync(path.join(destination, 'PREVALIDATION-RAN')),
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('forged commit, tree, archive blob, extra, unsafe, duplicate and case-collision members refuse', () => {
  const fixture = sourceFixture(),
    bytes = (m) => Buffer.from(canonical(m));
  const forgedCommit = structuredClone(fixture.manifest);
  forgedCommit.commit = 'f'.repeat(40);
  assert.throws(
    () =>
      verifySourceArchive({
        archiveBytes: fixture.archive,
        manifestBytes: bytes(forgedCommit),
      }),
    /forged source commit/
  );
  const forgedTree = structuredClone(fixture.manifest),
    fakeTree = 'e'.repeat(40);
  const commitBytes = Buffer.from(`tree ${fakeTree}\n\nforged\n`);
  forgedTree.tree = fakeTree;
  forgedTree.commit_object_base64 = commitBytes.toString('base64');
  forgedTree.commit = gitHash('commit', commitBytes);
  assert.throws(
    () =>
      verifySourceArchive({
        archiveBytes: fixture.archive,
        manifestBytes: bytes(forgedTree),
      }),
    /reconstruct declared Git tree/
  );
  const modified = buildZip(
    [...fixture.content].map(([p, b]) => ({
      path: p,
      content: p === 'package.json' ? Buffer.from('changed') : b,
    }))
  );
  assert.throws(
    () =>
      verifySourceArchive({
        archiveBytes: modified,
        manifestBytes: bytes(fixture.manifest),
      }),
    /modified Git blob/
  );
  for (const archive of [
    buildZip(
      [...fixture.content]
        .map(([p, b]) => ({ path: p, content: b }))
        .concat({ path: 'extra.js', content: Buffer.from('x') })
    ),
    buildZip([{ path: '../escape', content: Buffer.from('x') }]),
    buildZip([
      { path: 'A', content: Buffer.from('x') },
      { path: 'a', content: Buffer.from('x') },
    ]),
    buildZip([
      { path: 'package.json', content: fixture.content.get('package.json') },
      { path: 'package.json', content: fixture.content.get('package.json') },
    ]),
  ])
    assert.throws(() =>
      verifySourceArchive({
        archiveBytes: archive,
        manifestBytes: bytes(fixture.manifest),
      })
    );
});

test('MCPB opens both copies and enforces exact Windows membership and raw-byte identity', () => {
  const good = mcpbFixture(),
    digest = createHash('sha256').update(good.binary).digest('hex');
  assert.equal(
    validateMcpbBytes(good.archive, good.archive, digest).members.length,
    2
  );
  const extra = Buffer.from(
    buildZip([
      ...mcpbEntries(good),
      { path: 'extra.txt', content: Buffer.from('x') },
    ])
  );
  const missing = buildZip([mcpbEntries(good)[0]]);
  const wrong = mcpbFixture(Buffer.from('different')).archive;
  assert.throws(() => validateMcpbBytes(extra, extra, digest), /exactly two/);
  assert.throws(
    () => validateMcpbBytes(missing, missing, digest),
    /exactly two/
  );
  assert.throws(
    () => validateMcpbBytes(wrong, wrong, digest),
    /differs from the measured raw/
  );
  assert.throws(
    () =>
      validateMcpbBytes(
        good.archive,
        Buffer.from(good.archive).fill(0, 0, 1),
        digest
      ),
    /bytes differ/
  );
});
function mcpbEntries(fixture) {
  const manifest = {
    dxt_version: '0.1',
    name: 'lantern',
    server: {
      type: 'binary',
      entry_point: 'server/lantern-mcp.exe',
      mcp_config: { command: '${__dirname}/server/lantern-mcp.exe' },
    },
    compatibility: { platforms: ['x86_64-pc-windows-msvc'] },
  };
  return [
    { path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest)) },
    { path: 'server/lantern-mcp.exe', content: fixture.binary, mode: 0o100755 },
  ];
}

test('orchestrator validates first, uses npm ci and locked Cargo, and closes hostile environment', () => {
  const script = read('scripts/windows-final-build/build.ps1');
  assert.ok(
    script.indexOf('verify-source-archive.mjs') <
      script.indexOf("@('ci','--ignore-scripts')")
  );
  assert.match(script, /@\('ci','--ignore-scripts'\)/);
  assert.equal(
    (script.match(/@\('build','--locked','--release','--bin'/g) || []).length,
    2
  );
  for (const flag of [
    'VITE_FLAG_CRM_SHELL_V1',
    'VITE_FLAG_V1_SHELL_FRAME',
    'VITE_FLAG_SHARED_CLIENT_BAR',
  ])
    assert.doesNotMatch(script, new RegExp(`\\$env:${flag}=`));
  assert.match(script, /hostilePattern/);
  assert.match(
    read('scripts/windows-final-build/invoke-recorded.ps1'),
    /build-affecting environment reached command runner/
  );
  assert.equal(
    read('.env.production'),
    'VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE=true\nVITE_FLAG_MEETINGS_SHELL_V1=true\n'
  );
});

test('separate reconciler measures authority facts and refuses producer fact injection', () => {
  const producer = read('scripts/windows-final-build/build.ps1'),
    reconciler = read('scripts/windows-final-build/reconcile-build.mjs');
  assert.doesNotMatch(
    producer,
    /meta\.json|installer_h\s*=|signature_status\s*=|verified_uncompressed_payload_bytes\s*=/
  );
  for (const measured of [
    'fs.readFileSync(path.join(installerDir',
    'Get-AuthenticodeSignature',
    'validateMcpbBytes',
    'reconcilePayload',
    'sourceReceipt.commit',
  ])
    assert.ok(
      (
        reconciler + read('scripts/windows-final-build/measure-build.ps1')
      ).includes(measured),
      measured
    );
  const run = spawnSync(
    process.execPath,
    [
      'scripts/windows-final-build/reconcile-build.mjs',
      'fake-root',
      'BUILD-20260722-0001',
      'forged-producer-facts.json',
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /producer fact files are forbidden/);
});

test('Seven Zip cannot be mislabeled, raw MCP cannot escape, and installer size has no obsolete ceiling', () => {
  const measure = read('scripts/windows-final-build/measure-build.ps1'),
    contract = read('scripts/windows-final-build/contract.mjs'),
    payload = read('scripts/windows-final-build/reconcile-payload.mjs');
  assert.match(measure, /Tool 'sevenzip' \$SevenZipPath @\('i'\)/);
  assert.doesNotMatch(measure, /Tool 'sevenzip' \$rustc/);
  assert.match(payload, /raw lantern-mcp executable escaped the MCPB/);
  assert.match(
    read('scripts/windows-final-build/prepare-config.mjs'),
    /loose MCP executable forbidden/
  );
  assert.doesNotMatch(
    contract,
    /250\s*\*\s*1024|262_144_000|installer_bytes\s*>/
  );
});

test('Gmail inputs are correct and receipts cannot expose values, hashes, or lengths', () => {
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
  const releaseFiles = ['build.ps1', 'measure-build.ps1', 'reconcile-build.mjs']
    .map((name) => read(`scripts/windows-final-build/${name}`))
    .join('\n');
  assert.doesNotMatch(
    releaseFiles,
    /LANTERN_GMAIL_CLIENT_(?:ID|SECRET).{0,50}(?:value(?!_recorded)|hash|length|prefix|fingerprint)/i
  );
  assert.doesNotMatch(
    releaseFiles,
    /(?:value(?!_recorded)|hash|length|prefix|fingerprint).{0,50}LANTERN_GMAIL_CLIENT_(?:ID|SECRET)/i
  );
});

test('native recorder holds archive, tracked, packager and installer reads against links, ADS and races', () => {
  const recorder = read('scripts/windows-final-build/Recorder.cs'),
    producer = read('scripts/windows-final-build/build.ps1'),
    finalizer = read(
      'scripts/windows-final-build/finalize-measured-capsule.mjs'
    );
  for (const needle of [
    'OPEN_REPARSE',
    'FindFirstStreamW',
    'alternate stream forbidden',
    'case/NFC collision',
    'hard link forbidden',
    'file changed while hashing',
    'guard-file',
    'guard-list',
  ])
    assert.ok(recorder.includes(needle), needle);
  for (const stem of [
    "'archive'",
    "'manifest'",
    "'controller'",
    "'tracked'",
    "'packager'",
    "'installer'",
  ])
    assert.ok(producer.includes(stem), stem);
  assert.match(finalizer, /protected before\/after closure mismatch/);
});

test('unsigned override stays NSIS-only and complete meeting resources remain required', () => {
  const base = JSON.parse(read('src-tauri/tauri.conf.json')),
    over = JSON.parse(read('src-tauri/tauri.control-day-unsigned.conf.json')),
    prep = read('scripts/windows-final-build/prepare-config.mjs');
  assert.deepEqual(over.bundle.targets, ['nsis']);
  assert.equal(over.bundle.createUpdaterArtifacts, false);
  assert.equal(over.bundle.windows.signCommand, null);
  assert.equal(base.bundle.createUpdaterArtifacts, true);
  for (const needle of [
    'ggml-tiny',
    'ggml-base',
    'segmentation',
    'embedding',
    'lantern-diarize',
    'sherpa-onnx',
    'onnxruntime',
    'piper-x86_64',
    'llama-server-x86_64',
    'lantern-windows',
  ])
    assert.ok(prep.includes(needle), needle);
});
