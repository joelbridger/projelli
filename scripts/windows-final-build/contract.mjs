import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const TOP_FIELDS = [
  'schema',
  'build_id',
  'source',
  'fresh_root',
  'tracked_inputs',
  'generated_inputs',
  'staged_inputs',
  'toolchain',
  'commands',
  'environment',
  'effective_config',
  'packager_inputs',
  'installer_observation',
  'companions',
  'stability',
];
export const FILE_FIELDS = [
  'category',
  'logical_path',
  'bytes',
  'sha256',
  'identity_before',
  'identity_after',
];
export const TRACKED_FILE_FIELDS = [...FILE_FIELDS, 'git_mode', 'git_blob'];
export const BUILD_ID = /^[A-Z0-9][A-Z0-9-]{11,79}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fail(message) {
  throw new Error(message);
}
function exactKeys(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${where} must be an object`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    fail(`${where} has missing or unknown fields`);
}
export function validateLogicalPath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\x00-\x1f\x7f]/u.test(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  )
    fail(`unsafe logical_path: ${String(value)}`);
  if (value !== value.normalize('NFC')) fail(`non-NFC logical_path: ${value}`);
  for (const part of value.split('/')) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      part.includes(':') ||
      /[<>"|?*]/u.test(part) ||
      /[. ]$/.test(part) ||
      DEVICE.test(part) ||
      /[\x00-\x1f]/.test(part)
    )
      fail(`unsafe logical_path component: ${value}`);
  }
  return value;
}
function integer(value, where) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail(`${where} must be a nonnegative integer`);
}
function identity(value, where) {
  exactKeys(
    value,
    ['volume_serial', 'file_id', 'last_write_utc', 'links'],
    where
  );
  for (const key of ['volume_serial', 'file_id', 'last_write_utc'])
    if (typeof value[key] !== 'string' || /[\x00-\x1f\x7f]/u.test(value[key]))
      fail(`${where}.${key} invalid`);
  integer(value.links, `${where}.links`);
  if (value.links !== 1) fail(`${where} is a hard link`);
}
function fileRow(row, tracked, seen) {
  exactKeys(
    row,
    tracked ? TRACKED_FILE_FIELDS : FILE_FIELDS,
    row?.logical_path ?? 'file row'
  );
  validateLogicalPath(row.logical_path);
  const key = row.logical_path.normalize('NFC').toLowerCase();
  if (seen.has(key)) fail(`duplicate normalized path: ${row.logical_path}`);
  seen.add(key);
  if (
    typeof row.category !== 'string' ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(row.category)
  )
    fail('invalid category');
  integer(row.bytes, `${row.logical_path}.bytes`);
  if (!SHA256.test(row.sha256)) fail(`${row.logical_path}.sha256 invalid`);
  identity(row.identity_before, `${row.logical_path}.identity_before`);
  identity(row.identity_after, `${row.logical_path}.identity_after`);
  if (canonical(row.identity_before) !== canonical(row.identity_after))
    fail(`${row.logical_path} changed while read`);
  if (
    tracked &&
    (!/^(100644|100755|120000)$/.test(row.git_mode) ||
      !/^[0-9a-f]{40}$/.test(row.git_blob))
  )
    fail(`${row.logical_path} git identity invalid`);
}
function noForbiddenSecretShape(value, path = '') {
  if (
    value === null ||
    (typeof value === 'number' && !Number.isInteger(value)) ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  )
    fail(`${path || 'capsule'} contains null, float, or unsafe integer`);
  if (typeof value === 'string' && /[\x00-\x1f\x7f]/u.test(value))
    fail(`${path || 'capsule'} contains control characters`);
  if (Array.isArray(value))
    return value.forEach((entry, i) =>
      noForbiddenSecretShape(entry, `${path}[${i}]`)
    );
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (new Set(keys).size !== keys.length) fail(`${path} has duplicate keys`);
    for (const key of keys) {
      const full = `${path}.${key}`;
      if (
        key !== 'value_recorded' &&
        (/(secret|client_id).*(value|hash|length|prefix|fingerprint)|(?:value|hash|length|prefix|fingerprint).*(secret|client_id)/i.test(
          full
        ) ||
          /environment\.LANTERN_GMAIL_CLIENT_(?:ID|SECRET)\.(?:value|hash|length|prefix|fingerprint)$/i.test(
            full
          ))
      )
        fail(`forbidden secret-derived field: ${full}`);
      noForbiddenSecretShape(value[key], `${path}.${key}`);
    }
  }
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateCapsule(capsule) {
  exactKeys(capsule, TOP_FIELDS, 'capsule');
  noForbiddenSecretShape(capsule);
  if (capsule.schema !== 1 || !BUILD_ID.test(capsule.build_id))
    fail('invalid schema or build_id');
  exactKeys(
    capsule.source,
    [
      'commit',
      'tree',
      'archive_manifest_sha256',
      'server_archive_sha256',
      'legion_archive_sha256',
    ],
    'source'
  );
  if (
    !/^[0-9a-f]{40}$/.test(capsule.source.commit) ||
    !/^[0-9a-f]{40}$/.test(capsule.source.tree) ||
    !SHA256.test(capsule.source.archive_manifest_sha256) ||
    !SHA256.test(capsule.source.server_archive_sha256) ||
    capsule.source.server_archive_sha256 !==
      capsule.source.legion_archive_sha256
  )
    fail('invalid source binding');
  exactKeys(
    capsule.fresh_root,
    [
      'token',
      'volume_serial',
      'directory_file_id',
      'creation_event',
      'initial_inventory',
    ],
    'fresh_root'
  );
  if (
    capsule.fresh_root.token !== 'C:\\APH-Final-Builds\\{build_id}' ||
    capsule.fresh_root.creation_event !== 'created-previously-absent' ||
    !Array.isArray(capsule.fresh_root.initial_inventory) ||
    capsule.fresh_root.initial_inventory.length
  )
    fail('invalid fresh root proof');
  const seen = new Set();
  for (const row of capsule.tracked_inputs) fileRow(row, true, seen);
  for (const list of [capsule.generated_inputs, capsule.staged_inputs])
    for (const row of list) fileRow(row, false, seen);
  if (!Array.isArray(capsule.toolchain) || !Array.isArray(capsule.commands))
    fail('toolchain and commands must be arrays');
  const toolNames = new Set();
  for (const item of capsule.toolchain) {
    exactKeys(item, ['name', 'version', 'executable_sha256'], 'toolchain row');
    if (
      !/^(git|node|npm|rustc|cargo|tauri|msvc|cmake|clang|protoc|nsis|sevenzip|recorder)$/.test(
        item.name
      ) ||
      typeof item.version !== 'string' ||
      !SHA256.test(item.executable_sha256)
    )
      fail('invalid toolchain row');
    if (toolNames.has(item.name)) fail(`duplicate toolchain row: ${item.name}`);
    toolNames.add(item.name);
  }
  const requiredTools = [
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
  ];
  if (
    requiredTools.some((name) => !toolNames.has(name)) ||
    toolNames.size !== requiredTools.length
  )
    fail('toolchain is not the exact required set');
  for (const item of capsule.commands) {
    exactKeys(
      item,
      ['cwd', 'argv', 'started_utc', 'ended_utc', 'exit_code'],
      'command row'
    );
    if (
      !/^(ROOT|ROOT\/src-tauri)$/.test(item.cwd) ||
      !Array.isArray(item.argv) ||
      item.argv.some(
        (arg) =>
          typeof arg !== 'string' ||
          /[\x00-\x1f\x7f]/u.test(arg) ||
          /SECRET|CLIENT_ID/i.test(arg)
      ) ||
      item.exit_code !== 0
    )
      fail('unsafe command diary row');
  }
  exactKeys(
    capsule.environment,
    ['LANTERN_GMAIL_CLIENT_ID', 'LANTERN_GMAIL_CLIENT_SECRET'],
    'environment'
  );
  for (const name of Object.keys(capsule.environment)) {
    exactKeys(capsule.environment[name], ['present', 'value_recorded'], name);
    if (
      typeof capsule.environment[name].present !== 'boolean' ||
      capsule.environment[name].value_recorded !== false
    )
      fail(`invalid ${name} record`);
  }
  exactKeys(
    capsule.effective_config,
    ['base_sha256', 'unsigned_override_sha256', 'merged_sha256'],
    'effective_config'
  );
  for (const value of Object.values(capsule.effective_config))
    if (!SHA256.test(value)) fail('invalid effective config digest');
  if (
    !Array.isArray(capsule.packager_inputs) ||
    capsule.packager_inputs.length === 0
  )
    fail('packager_inputs must be a nonempty array');
  const packagerSeen = new Set();
  for (const value of capsule.packager_inputs) {
    validateLogicalPath(value);
    const key = value.normalize('NFC').toLowerCase();
    if (packagerSeen.has(key) || !seen.has(key) || value.includes('*'))
      fail(`invalid packager input: ${value}`);
    packagerSeen.add(key);
  }
  exactKeys(capsule.stability, ['before', 'after'], 'stability');
  if (
    canonical(capsule.stability.before) !== canonical(capsule.stability.after)
  )
    fail('before/after stability inventories differ');
  const observation = capsule.installer_observation;
  exactKeys(
    observation,
    [
      'installer_h',
      'installer_bytes',
      'signature_status',
      'verified_uncompressed_payload_bytes',
      'inspection_tool',
      'extracted_payload',
      'lantern_exe_sha256',
    ],
    'installer_observation'
  );
  if (
    observation?.signature_status !== 'NotSigned' ||
    !SHA256.test(observation?.installer_h ?? '') ||
    !SHA256.test(observation?.lantern_exe_sha256 ?? '')
  )
    fail('invalid installer observation');
  integer(observation.installer_bytes, 'installer bytes');
  integer(observation.verified_uncompressed_payload_bytes, 'payload bytes');
  if (observation.installer_bytes <= 0)
    fail('installer measurement must be positive');
  exactKeys(
    observation.inspection_tool,
    ['name', 'version', 'executable_sha256'],
    'inspection_tool'
  );
  if (
    observation.inspection_tool.name !== 'sevenzip' ||
    !SHA256.test(observation.inspection_tool.executable_sha256) ||
    canonical(observation.inspection_tool) !==
      canonical(capsule.toolchain.find((tool) => tool.name === 'sevenzip'))
  )
    fail('invalid inspection tool');
  const payloadSeen = new Set();
  for (const row of observation.extracted_payload)
    fileRow(row, false, payloadSeen);
  const embedded = observation.extracted_payload.filter(
    (row) => row.logical_path === 'lantern.exe'
  );
  if (
    embedded.length !== 1 ||
    embedded[0].sha256 !== observation.lantern_exe_sha256
  )
    fail('extracted lantern.exe does not equal X');
  if (!Array.isArray(capsule.companions) || capsule.companions.length !== 1)
    fail('exactly one companion required');
  const companion = capsule.companions[0];
  exactKeys(
    companion,
    ['logical_path', 'bytes', 'sha256', 'classification'],
    'companion'
  );
  validateLogicalPath(companion.logical_path);
  integer(companion.bytes, 'companion bytes');
  if (
    !companion.logical_path.endsWith('.mcpb') ||
    !SHA256.test(companion.sha256) ||
    companion.classification !== 'byte-identical-embedded-companion'
  )
    fail('invalid MCPB companion');
  const stagedMcpb = capsule.staged_inputs.filter(
    (row) =>
      row.logical_path === 'src-tauri/resources/mcpb/lantern-windows.mcpb'
  );
  const payloadMcpb = observation.extracted_payload.filter(
    (row) => row.logical_path === 'mcpb/lantern-windows.mcpb'
  );
  if (
    stagedMcpb.length !== 1 ||
    payloadMcpb.length !== 1 ||
    stagedMcpb[0].sha256 !== companion.sha256 ||
    payloadMcpb[0].sha256 !== companion.sha256 ||
    stagedMcpb[0].bytes !== companion.bytes ||
    payloadMcpb[0].bytes !== companion.bytes
  )
    fail('embedded/payload/companion MCPB byte identity is not closed');
  return capsule;
}
export function writeCapsule(path, capsule) {
  validateCapsule(capsule);
  const bytes = Buffer.from(canonical(capsule), 'utf8');
  if (
    !bytes.length ||
    bytes.length > 67_108_864 ||
    bytes.at(-1) === 10 ||
    (bytes.includes(0xef) &&
      bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
  )
    fail('invalid capsule encoding or size');
  fs.writeFileSync(path, bytes, { flag: 'wx' });
  return sha256(bytes);
}
