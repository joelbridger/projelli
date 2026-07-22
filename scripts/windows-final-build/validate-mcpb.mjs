import fs from 'node:fs';
import { canonical, sha256 } from './contract.mjs';
import { readZip } from './archive.mjs';

export function validateMcpbBytes(
  embeddedBytes,
  companionBytes,
  expectedExecutableSha256
) {
  if (!Buffer.from(embeddedBytes).equals(Buffer.from(companionBytes)))
    throw new Error('embedded and companion MCPB bytes differ');
  const { entries } = readZip(embeddedBytes);
  if (entries.length !== 2 || entries.some((entry) => entry.directory))
    throw new Error('MCPB must contain exactly two regular members');
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (
    byName.size !== 2 ||
    !byName.has('manifest.json') ||
    !byName.has('server/lantern-mcp.exe')
  )
    throw new Error('MCPB exact Windows member set is invalid');
  const manifestEntry = byName.get('manifest.json'),
    executable = byName.get('server/lantern-mcp.exe');
  if (
    (manifestEntry.mode & 0o777) !== 0o644 ||
    (executable.mode & 0o777) !== 0o755
  )
    throw new Error('MCPB member modes are not canonical');
  if (
    manifestEntry.content.length > 1_048_576 ||
    executable.content.length <= 0 ||
    executable.content.length > 268_435_456
  )
    throw new Error(
      'MCPB member size is outside the bounded package structure'
    );
  const manifestText = manifestEntry.content.toString('utf8');
  if (
    !Buffer.from(manifestText, 'utf8').equals(manifestEntry.content) ||
    manifestText.charCodeAt(0) === 0xfeff
  )
    throw new Error('MCPB manifest encoding invalid');
  const manifest = JSON.parse(manifestText);
  if (
    manifest.dxt_version !== '0.1' ||
    manifest.name !== 'lantern' ||
    manifest.server?.type !== 'binary' ||
    manifest.server?.entry_point !== 'server/lantern-mcp.exe' ||
    manifest.server?.mcp_config?.command !==
      '${__dirname}/server/lantern-mcp.exe' ||
    !Array.isArray(manifest.compatibility?.platforms) ||
    manifest.compatibility.platforms.length !== 1 ||
    manifest.compatibility.platforms[0] !== 'x86_64-pc-windows-msvc'
  )
    throw new Error(
      'MCPB manifest does not canonically select the Windows MCP executable'
    );
  const executableSha256 = sha256(executable.content);
  if (executableSha256 !== expectedExecutableSha256)
    throw new Error(
      'MCPB executable differs from the measured raw MCP executable'
    );
  return {
    schema: 1,
    archive_sha256: sha256(embeddedBytes),
    archive_bytes: embeddedBytes.length,
    executable_path: 'server/lantern-mcp.exe',
    executable_sha256: executableSha256,
    members: entries.map((entry) => ({
      logical_path: entry.name,
      bytes: entry.content.length,
      sha256: sha256(entry.content),
    })),
  };
}

if (process.argv[1]?.endsWith('validate-mcpb.mjs')) {
  const [embeddedPath, companionPath, rawInventoryPath, receiptPath] =
    process.argv.slice(2);
  if (!receiptPath)
    throw new Error(
      'usage: validate-mcpb.mjs <embedded> <companion> <raw-inventory> <receipt>'
    );
  const raw = JSON.parse(fs.readFileSync(rawInventoryPath, 'utf8')).rows;
  if (
    raw.length !== 1 ||
    raw[0].logical_path !==
      'src-tauri/binaries/lantern-mcp-x86_64-pc-windows-msvc.exe'
  )
    throw new Error('raw MCP inventory is not exact');
  const receipt = validateMcpbBytes(
    fs.readFileSync(embeddedPath),
    fs.readFileSync(companionPath),
    raw[0].sha256
  );
  fs.writeFileSync(receiptPath, canonical(receipt), {
    encoding: 'ascii',
    flag: 'wx',
  });
  process.stdout.write(
    'Validated exact embedded and companion MCPB packages.\n'
  );
}
