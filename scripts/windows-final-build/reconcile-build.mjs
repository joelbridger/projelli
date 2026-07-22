import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256, validateCapsule } from './contract.mjs';
import { validateSourceManifest } from './archive.mjs';
import { validateMcpbBytes } from './validate-mcpb.mjs';
import { reconcilePayload } from './reconcile-payload.mjs';

const args = process.argv.slice(2);
if (args.length !== 2)
  throw new Error(
    'usage: reconcile-build.mjs <fixed-build-root> <build-id>; producer fact files are forbidden'
  );
const [buildRoot, buildId] = args;
const source = path.join(buildRoot, 'source'),
  evidence = path.join(buildRoot, '.aph-provenance');
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
const sourceReceipt = read('source-validated.json');
const manifestBytes = fs.readFileSync(
  path.join(evidence, 'tracked-manifest.json')
);
const { manifest, manifest_sha256 } = validateSourceManifest(manifestBytes);
const archiveGuard = read('archive-before.json'),
  manifestGuard = read('manifest-before.json');
if (
  archiveGuard.rows.length !== 1 ||
  archiveGuard.rows[0].sha256 !== sourceReceipt.archive_sha256
)
  throw new Error('archive guard does not bind validated source bytes');
if (
  manifestGuard.rows.length !== 1 ||
  manifestGuard.rows[0].sha256 !== manifest_sha256 ||
  sourceReceipt.archive_manifest_sha256 !== manifest_sha256
)
  throw new Error('manifest guard does not bind validated source identity');
if (
  sourceReceipt.commit !== manifest.commit ||
  sourceReceipt.tree !== manifest.tree
)
  throw new Error('source receipt identity mismatch');
const trackedGuard = read('tracked-before.json'),
  packageGuard = read('packager-before.json');
const packageByPath = new Map(
  packageGuard.rows.map((row) => [row.logical_path, row])
);
if (packageByPath.size !== packageGuard.rows.length)
  throw new Error('duplicate packager inventory path');
const trackedByPath = new Map(
  trackedGuard.rows.map((row) => [row.logical_path, row])
);
const sourceFiles = new Map(
  sourceReceipt.files.map((file) => [file.path, file])
);
if (trackedByPath.size !== manifest.files.length)
  throw new Error('tracked guard is not the exact source manifest');
const trackedInputs = manifest.files.map((git) => {
  const row = trackedByPath.get(git.path),
    packaged = packageByPath.get(git.path),
    sourceFile = sourceFiles.get(git.path);
  if (
    !row ||
    !packaged ||
    !sourceFile ||
    sourceFile.blob !== git.blob ||
    sourceFile.sha256 !== row.sha256 ||
    row.sha256 !== packaged.sha256 ||
    row.bytes !== git.bytes
  )
    throw new Error(`tracked source closure mismatch: ${git.path}`);
  return {
    ...row,
    category: 'tracked',
    git_mode: git.mode,
    git_blob: git.blob,
  };
});
const generatedInputs = [],
  stagedInputs = [];
for (const row of packageGuard.rows) {
  if (trackedByPath.has(row.logical_path)) continue;
  if (
    /^(?:dist|public\/ocr|public\/pdf\.worker|src-tauri\/tauri\.control-day-effective\.generated\.json|src-tauri\/target\/release\/lantern\.exe)/.test(
      row.logical_path
    )
  )
    generatedInputs.push({ ...row, category: 'generated' });
  else if (
    /^(?:src-tauri\/(?:binaries|resources|voices)|mcpb-dist)\//.test(
      row.logical_path
    )
  )
    stagedInputs.push({ ...row, category: 'staged' });
  else
    throw new Error(
      `unmeasured/unexplained packager input: ${row.logical_path}`
    );
}
const inputList = fs
  .readFileSync(path.join(evidence, 'inputs.txt'), 'ascii')
  .trimEnd()
  .split('\n');
if (
  canonical([...inputList].sort()) !==
  canonical([...packageByPath.keys()].sort())
)
  throw new Error('packager list and guarded bytes differ');
const envText = fs.readFileSync(path.join(source, '.env.production'), 'utf8');
if (
  envText !==
  'VITE_FLAG_SELECTION_AUTHORITY_BOOT_GATE=true\nVITE_FLAG_MEETINGS_SHELL_V1=true\n'
)
  throw new Error(
    'tracked .env.production is not the approved effective production environment'
  );
for (const forbidden of [
  'VITE_FLAG_CRM_SHELL_V1',
  'VITE_FLAG_V1_SHELL_FRAME',
  'VITE_FLAG_SHARED_CLIENT_BAR',
])
  if (Object.hasOwn(process.env, forbidden))
    throw new Error(`hostile feature flag reached reconciler: ${forbidden}`);
const commands = fs
  .readdirSync(path.join(evidence, 'commands'))
  .sort()
  .map((name) =>
    JSON.parse(fs.readFileSync(path.join(evidence, 'commands', name), 'utf8'))
  );
if (commands.length !== 16)
  throw new Error('measured command diary is not the exact closed recipe');
const commandText = commands.map((row) => row.argv.join(' ')).join('\n');
for (const required of [
  'npm.cmd ci --ignore-scripts',
  'cargo.exe build --locked --release --bin lantern-mcp',
  'npm.cmd run build',
  'cargo.exe build --locked --release --bin lantern',
  'npm.cmd exec -- tauri build --bundles nsis',
])
  if (!commandText.includes(required))
    throw new Error(`required measured command absent: ${required}`);
if (/cargo\.exe build (?![^\n]*--locked)/.test(commandText))
  throw new Error('unlocked Cargo command recorded');
const observed = read('observed.json');
if (
  canonical(Object.keys(observed).sort()) !==
    canonical(
      [
        'gmail_client_id_present',
        'gmail_client_secret_present',
        'schema',
        'signature_status',
        'toolchain',
      ].sort()
    ) ||
  observed.schema !== 1
)
  throw new Error('measurement receipt has missing or producer-injected facts');
const sevenzip = observed.toolchain.find((tool) => tool.name === 'sevenzip');
if (
  !sevenzip ||
  !/7-Zip/i.test(sevenzip.version) ||
  /rustc/i.test(sevenzip.version)
)
  throw new Error('Seven Zip tool identity is wrong');
const installerDir = path.join(
  source,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'nsis'
);
const installers = fs
  .readdirSync(installerDir)
  .filter((name) => name.endsWith('-setup.exe'));
if (installers.length !== 1 || observed.signature_status !== 'NotSigned')
  throw new Error('installer/signature observation invalid');
const installerBytes = fs.readFileSync(path.join(installerDir, installers[0]));
const payload = read('payload.json').rows,
  payloadBytes = payload.reduce((sum, row) => sum + row.bytes, 0);
const x = sha256(
  fs.readFileSync(
    path.join(source, 'src-tauri', 'target', 'release', 'lantern.exe')
  )
);
const basePath = path.join(source, 'src-tauri', 'tauri.conf.json'),
  overridePath = path.join(
    source,
    'src-tauri',
    'tauri.control-day-unsigned.conf.json'
  ),
  mergedPath = path.join(
    source,
    'src-tauri',
    'tauri.control-day-effective.generated.json'
  );
const merged = JSON.parse(fs.readFileSync(mergedPath));
const payloadExe = payload.filter((row) => row.logical_path === 'lantern.exe');
if (payloadExe.length !== 1 || payloadExe[0].sha256 !== x)
  throw new Error('extracted Lantern executable differs from X');
reconcilePayload(merged, packageGuard.rows, payload, x);
const embeddedPath = path.join(
  source,
  'src-tauri',
  'resources',
  'mcpb',
  'lantern-windows.mcpb'
);
const companionPath = path.join(source, 'mcpb-dist', 'lantern-windows.mcpb');
const raw = read('raw-mcp.json').rows;
if (raw.length !== 1) throw new Error('raw MCP measurement missing');
const mcpb = validateMcpbBytes(
  fs.readFileSync(embeddedPath),
  fs.readFileSync(companionPath),
  raw[0].sha256
);
if (
  packageGuard.rows.some((row) =>
    /(?:^|\/)lantern-mcp(?:-[^/]*)?\.exe$/i.test(row.logical_path)
  ) ||
  payload.some((row) =>
    /(?:^|\/)lantern-mcp(?:-[^/]*)?\.exe$/i.test(row.logical_path)
  )
)
  throw new Error('raw MCP executable escaped its MCPB package');
for (const loose of [
  path.join(source, 'src-tauri', 'target', 'release', 'lantern-mcp.exe'),
  path.join(
    source,
    'src-tauri',
    'binaries',
    'lantern-mcp-x86_64-pc-windows-msvc.exe'
  ),
])
  if (fs.existsSync(loose))
    throw new Error('raw MCP executable remains loose after MCPB assembly');
if (
  canonical(merged.bundle.targets) !== canonical(['nsis']) ||
  merged.bundle.createUpdaterArtifacts !== false ||
  merged.bundle.windows.signCommand !== null
)
  throw new Error('effective config is not unsigned NSIS-only/updater-off');
const empty = read('empty.json');
const capsule = {
  schema: 1,
  build_id: buildId,
  source: {
    commit: sourceReceipt.commit,
    tree: sourceReceipt.tree,
    archive_manifest_sha256: manifest_sha256,
    server_archive_sha256: sourceReceipt.archive_sha256,
    legion_archive_sha256: archiveGuard.rows[0].sha256,
  },
  fresh_root: {
    token: 'C:\\APH-Final-Builds\\{build_id}',
    volume_serial: empty.root_identity.volume_serial,
    directory_file_id: empty.root_identity.file_id,
    creation_event: 'created-previously-absent',
    initial_inventory: empty.rows,
  },
  tracked_inputs: trackedInputs,
  generated_inputs: generatedInputs.sort((a, b) =>
    a.logical_path.localeCompare(b.logical_path)
  ),
  staged_inputs: stagedInputs.sort((a, b) =>
    a.logical_path.localeCompare(b.logical_path)
  ),
  toolchain: observed.toolchain,
  commands,
  environment: {
    LANTERN_GMAIL_CLIENT_ID: {
      present: observed.gmail_client_id_present,
      value_recorded: false,
    },
    LANTERN_GMAIL_CLIENT_SECRET: {
      present: observed.gmail_client_secret_present,
      value_recorded: false,
    },
  },
  effective_config: {
    base_sha256: sha256(fs.readFileSync(basePath)),
    unsigned_override_sha256: sha256(fs.readFileSync(overridePath)),
    merged_sha256: sha256(fs.readFileSync(mergedPath)),
  },
  packager_inputs: inputList,
  installer_observation: {
    installer_h: sha256(installerBytes),
    installer_bytes: installerBytes.length,
    signature_status: observed.signature_status,
    verified_uncompressed_payload_bytes: payloadBytes,
    inspection_tool: sevenzip,
    extracted_payload: payload,
    lantern_exe_sha256: x,
  },
  companions: [
    {
      logical_path: 'mcpb-dist/lantern-windows.mcpb',
      bytes: mcpb.archive_bytes,
      sha256: mcpb.archive_sha256,
      classification: 'byte-identical-embedded-companion',
    },
  ],
  stability: { before: packageGuard.rows, after: packageGuard.rows },
};
validateCapsule(capsule);
fs.writeFileSync(
  path.join(evidence, 'capsule-fragment.json'),
  canonical(capsule),
  { encoding: 'utf8', flag: 'wx' }
);
process.stdout.write(
  'Independent reconciliation emitted a measured, pre-closure capsule fragment.\n'
);
