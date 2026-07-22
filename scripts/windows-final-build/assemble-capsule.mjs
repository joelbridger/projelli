import fs from 'node:fs';
import { canonical, sha256 } from './contract.mjs';

const [metaPath, beforePath, afterPath, trackedManifestPath, outPath] =
  process.argv.slice(2);
if (!outPath)
  throw new Error(
    'usage: assemble-capsule.mjs <meta> <before> <after> <tracked-manifest> <fragment>'
  );
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const meta = read(metaPath),
  before = read(beforePath),
  after = read(afterPath),
  trackedManifest = read(trackedManifestPath);
const byPath = new Map(before.rows.map((row) => [row.logical_path, row]));
const trackedByPath = new Map(
  trackedManifest
    .filter((row) => row.type === 'blob')
    .map((row) => [row.path, row])
);
const tracked = [];
const generated = [];
const staged = [];
for (const [logical_path, git] of trackedByPath) {
  const row = byPath.get(logical_path);
  if (!row) throw new Error(`tracked input absent: ${logical_path}`);
  tracked.push({
    ...row,
    category: 'tracked',
    git_mode: git.mode,
    git_blob: git.blob,
  });
  byPath.delete(logical_path);
}
for (const row of byPath.values()) {
  if (
    /^(dist|public\/ocr|public\/pdf\.worker|src-tauri\/tauri\.control-day-effective\.generated\.json|src-tauri\/target\/release\/lantern\.exe)/.test(
      row.logical_path
    )
  )
    generated.push({ ...row, category: 'generated' });
  else if (
    /^(src-tauri\/(?:binaries|resources|voices)|mcpb-dist)\//.test(
      row.logical_path
    )
  )
    staged.push({ ...row, category: 'staged' });
  else throw new Error(`unexplained input: ${row.logical_path}`);
}
const capsule = {
  schema: 1,
  build_id: meta.build_id,
  source: {
    commit: meta.commit,
    tree: meta.tree,
    archive_manifest_sha256: sha256(fs.readFileSync(trackedManifestPath)),
    server_archive_sha256: meta.server_archive_sha256,
    legion_archive_sha256: meta.legion_archive_sha256,
  },
  fresh_root: meta.fresh_root,
  tracked_inputs: tracked.sort((a, b) =>
    a.logical_path.localeCompare(b.logical_path)
  ),
  generated_inputs: generated.sort((a, b) =>
    a.logical_path.localeCompare(b.logical_path)
  ),
  staged_inputs: staged.sort((a, b) =>
    a.logical_path.localeCompare(b.logical_path)
  ),
  toolchain: meta.toolchain,
  commands: meta.commands,
  environment: {
    LANTERN_GMAIL_CLIENT_ID: {
      present: meta.gmail_client_id_present,
      value_recorded: false,
    },
    LANTERN_GMAIL_CLIENT_SECRET: {
      present: meta.gmail_client_secret_present,
      value_recorded: false,
    },
  },
  effective_config: meta.effective_config,
  packager_inputs: meta.packager_inputs,
  installer_observation: meta.installer_observation,
  companions: meta.companions,
  stability: { before: before.rows, after: after.rows },
};
fs.writeFileSync(outPath, canonical(capsule), {
  encoding: 'ascii',
  flag: 'wx',
});
