// scripts/bench-smoke/remote.mjs — SSH/SCP invocation builders + thin exec
// wrappers for driving a bench. Mirrors scripts/legion-drive.sh's pattern
// exactly (same ssh options, same "cd <repo>; set DESKTOP_CDP_PORT; node
// scripts/desktop-drive.mjs <args>" remote command shape) but parameterized
// by target instead of hardcoded to the Legion, and driven from Node instead
// of bash so results can be parsed and asserted on programmatically.
//
// This intentionally does NOT reimplement any of desktop-drive.mjs's CDP/
// Playwright connection logic — it always reuses the real script by invoking
// it, unmodified, as a subprocess on the bench (exactly what legion-drive.sh
// already does over SSH). desktop-drive.mjs has no exported functions to
// `import` (it's a top-level-await CLI), so subprocess invocation is the only
// reuse path that doesn't fork or duplicate its logic.
import { spawn } from 'node:child_process';

const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=5',
  '-o', 'StrictHostKeyChecking=no',
];

/** Quote a single argument for a PowerShell remote command (single-quoted,
 * literal string; embedded single quotes doubled per PowerShell escaping). */
export function psQuote(arg) {
  return `'${String(arg).replace(/'/g, "''")}'`;
}

export function buildRemoteCommandString(target, desktopDriveArgs) {
  const quotedArgs = desktopDriveArgs.map(psQuote).join(' ');
  return (
    `cd ${psQuote(target.repoDir)}; ` +
    `[Environment]::SetEnvironmentVariable('DESKTOP_CDP_PORT','9223'); ` +
    `node scripts/desktop-drive.mjs ${quotedArgs}`
  );
}

export function buildSshArgs(target, remoteCommand) {
  return [...SSH_OPTS, `${target.sshUser}@${target.sshHost}`, remoteCommand];
}

export function buildDesktopDriveInvocation(target, desktopDriveArgs) {
  return { file: 'ssh', args: buildSshArgs(target, buildRemoteCommandString(target, desktopDriveArgs)) };
}

export function buildProbeInvocation(target) {
  return { file: 'ssh', args: buildSshArgs(target, 'exit 0') };
}

/** Windows backslash path -> the forward-slash form OpenSSH's scp accepts in a remote spec. */
export function toScpRemotePath(winPath) {
  return winPath.replace(/\\/g, '/');
}

export function buildScpDownloadInvocation(target, remoteWinPath, localPath) {
  const remoteSpec = `${target.sshUser}@${target.sshHost}:${toScpRemotePath(remoteWinPath)}`;
  return { file: 'scp', args: [...SSH_OPTS, remoteSpec, localPath] };
}

/** Run a built invocation, always resolving (never rejects) with {code, stdout, stderr}. */
export function execInvocation({ file, args, stdinText }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: [stdinText == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    if (stdinText != null) child.stdin.end(stdinText);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
  });
}

export async function probeReachable(target) {
  const { code } = await execInvocation(buildProbeInvocation(target));
  return code === 0;
}

export async function runDesktopDrive(target, desktopDriveArgs, { stdinText } = {}) {
  return execInvocation({ ...buildDesktopDriveInvocation(target, desktopDriveArgs), stdinText });
}

export async function downloadFile(target, remoteWinPath, localPath) {
  return execInvocation(buildScpDownloadInvocation(target, remoteWinPath, localPath));
}
