import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, validateCapsule, writeCapsule } from './contract.mjs';
const h = 'a'.repeat(64),
  id = {
    volume_serial: '1234abcd',
    file_id: '0000000000000001',
    last_write_utc: '2026-07-22T00:00:00.0000000Z',
    links: 1,
  };
const row = {
  category: 'tracked',
  logical_path: 'package.json',
  bytes: 1,
  sha256: h,
  identity_before: id,
  identity_after: id,
  git_mode: '100644',
  git_blob: 'b'.repeat(40),
};
const stabilityRow = {
  category: 'input',
  logical_path: 'package.json',
  bytes: 1,
  sha256: h,
  identity_before: id,
  identity_after: id,
};
const good = {
  schema: 1,
  build_id: 'BUILD-20260722-0001',
  source: {
    commit: 'c'.repeat(40),
    tree: 'd'.repeat(40),
    archive_manifest_sha256: h,
    server_archive_sha256: h,
    legion_archive_sha256: h,
  },
  fresh_root: {
    token: 'C:\\APH-Final-Builds\\{build_id}',
    volume_serial: 'a',
    directory_file_id: 'b',
    creation_event: 'created-previously-absent',
    initial_inventory: [],
  },
  tracked_inputs: [row],
  generated_inputs: [],
  staged_inputs: [
    {
      ...stabilityRow,
      category: 'staged',
      logical_path: 'src-tauri/resources/mcpb/lantern-windows.mcpb',
    },
  ],
  toolchain: [
    'git',
    'node',
    'npm',
    'rustc',
    'cargo',
    'tauri',
    'msvc',
    'cmake',
    'clang',
    'protoc',
    'nsis',
    'sevenzip',
    'recorder',
  ].map((name) => ({
    name,
    version: name === 'sevenzip' ? '7-Zip 24' : 'v1',
    executable_sha256: h,
  })),
  commands: [
    {
      cwd: 'ROOT',
      argv: ['node.exe', 'safe.mjs'],
      started_utc: '2026-07-22T00:00:00Z',
      ended_utc: '2026-07-22T00:00:01Z',
      exit_code: 0,
    },
  ],
  environment: {
    LANTERN_GMAIL_CLIENT_ID: { present: true, value_recorded: false },
    LANTERN_GMAIL_CLIENT_SECRET: { present: true, value_recorded: false },
  },
  effective_config: {
    base_sha256: h,
    unsigned_override_sha256: h,
    merged_sha256: h,
  },
  packager_inputs: ['package.json'],
  installer_observation: {
    installer_h: h,
    installer_bytes: 10,
    signature_status: 'NotSigned',
    verified_uncompressed_payload_bytes: 20,
    inspection_tool: {
      name: 'sevenzip',
      version: '7-Zip 24',
      executable_sha256: h,
    },
    extracted_payload: [
      {
        ...stabilityRow,
        category: 'installer-payload',
        logical_path: 'lantern.exe',
      },
      {
        ...stabilityRow,
        category: 'installer-payload',
        logical_path: 'mcpb/lantern-windows.mcpb',
      },
    ],
    lantern_exe_sha256: h,
  },
  companions: [
    {
      logical_path: 'mcpb-dist/lantern-windows.mcpb',
      bytes: 1,
      sha256: h,
      classification: 'byte-identical-embedded-companion',
    },
  ],
  stability: { before: [stabilityRow], after: [stabilityRow] },
};
validateCapsule(good);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-fixture-')),
  out = path.join(dir, 'build-capsule.json');
writeCapsule(out, good);
const bytes = fs.readFileSync(out);
assert.equal(bytes.at(-1) === 10, false);
assert.equal(bytes.toString('utf8'), canonical(good));
for (const mutate of [
  (x) => (x.tracked_inputs[0].logical_path = 'CON.txt'),
  (x) => (x.environment.LANTERN_GMAIL_CLIENT_SECRET.value = 'forbidden'),
  (x) => (x.commands[0].exit_code = 1),
  (x) => (x.installer_observation.signature_status = 'Valid'),
  (x) => (x.schema = 1.5),
  (x) => (x.stability.after = []),
]) {
  const bad = structuredClone(good);
  mutate(bad);
  assert.throws(() => validateCapsule(bad));
}
const duplicate = structuredClone(good);
duplicate.generated_inputs = [
  { ...stabilityRow, category: 'generated', logical_path: 'PACKAGE.JSON' },
];
assert.throws(() => validateCapsule(duplicate));
fs.rmSync(dir, { recursive: true, force: true });
console.log('APH-BUILD-CAPSULE-V1 synthetic fixture passed.');
