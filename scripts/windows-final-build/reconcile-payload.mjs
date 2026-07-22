import fs from 'node:fs';
export function reconcilePayload(config, inputs, payload, xHash) {
  const inputByPath = new Map(inputs.map((row) => [row.logical_path, row]));
  const expected = new Map([['lantern.exe', xHash]]);
  for (const [source, target] of Object.entries(config.bundle.resources)) {
    const row = inputByPath.get(`src-tauri/${source}`);
    if (!row)
      throw new Error(
        `resolved resource missing from guarded inputs: ${source}`
      );
    expected.set(target, row.sha256);
  }
  for (const [source, target] of [
    ['src-tauri/binaries/piper-x86_64-pc-windows-msvc.exe', 'piper.exe'],
    [
      'src-tauri/binaries/llama-server-x86_64-pc-windows-msvc.exe',
      'llama-server.exe',
    ],
  ]) {
    const row = inputByPath.get(source);
    if (!row) throw new Error(`external binary missing: ${source}`);
    expected.set(target, row.sha256);
  }
  const generated = new Set([
    '$PLUGINSDIR/System.dll',
    '$PLUGINSDIR/modern-wizard.bmp',
    '$PLUGINSDIR/nsDialogs.dll',
    '$PLUGINSDIR/nsis_tauri_utils.dll',
    '$PLUGINSDIR/StartMenu.dll',
    '$PLUGINSDIR/modern-header.bmp',
    '$PLUGINSDIR/NSISdl.dll',
  ]);
  const seen = new Set();
  for (const row of payload) {
    if (generated.has(row.logical_path)) {
      seen.add(row.logical_path);
      continue;
    }
    const digest = expected.get(row.logical_path);
    if (!digest)
      throw new Error(
        `unexplained extracted payload file: ${row.logical_path}`
      );
    if (digest !== row.sha256)
      throw new Error(`payload hash mismatch: ${row.logical_path}`);
    if (seen.has(row.logical_path))
      throw new Error(`duplicate payload path: ${row.logical_path}`);
    seen.add(row.logical_path);
  }
  for (const name of expected.keys())
    if (!seen.has(name))
      throw new Error(`expected payload file absent: ${name}`);
  for (const name of generated)
    if (!seen.has(name))
      throw new Error(`pinned NSIS generated input absent: ${name}`);
  if (
    payload.some((row) =>
      /(?:^|\/)lantern-mcp(?:-[^/]*)?\.exe$/i.test(row.logical_path)
    )
  )
    throw new Error('raw lantern-mcp executable escaped the MCPB');
  console.log(
    `Extracted payload reconciled: ${expected.size} app files and ${generated.size} pinned NSIS files.`
  );
}

if (process.argv[1]?.endsWith('reconcile-payload.mjs')) {
  const [configPath, inputPath, payloadPath, xHash] = process.argv.slice(2);
  if (!xHash)
    throw new Error(
      'config, input inventory, payload inventory, and X hash required'
    );
  reconcilePayload(
    JSON.parse(fs.readFileSync(configPath, 'utf8')),
    JSON.parse(fs.readFileSync(inputPath, 'utf8')).rows,
    JSON.parse(fs.readFileSync(payloadPath, 'utf8')).rows,
    xHash
  );
}
