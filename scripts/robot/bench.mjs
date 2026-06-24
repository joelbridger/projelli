import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export const LEGION = 'james@100.127.67.22';
// On-disk vector index for the Northcrest demo workspace. Plain Windows path;
// JS-escaped backslashes only (NOT shell-escaped). Passed inside a PowerShell
// single-quoted string by deleteIndex(), so PowerShell sees C:\...\.keepance.
export const WS_KEEPANCE_INDEX = 'C:\\keepance-demo-northcrest\\Northcrest Wealth Partners\\.keepance';

const SSH_OPTS = ['-o', 'ConnectTimeout=10'];

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function sshExec(psCommand) {
  return execFileSync('ssh', [...SSH_OPTS, LEGION, psCommand], { encoding: 'utf8' });
}

export function scpTo(localPath, remotePath) {
  execFileSync('scp', [...SSH_OPTS, localPath, `${LEGION}:${remotePath}`]);
}

export async function ensureTunnel(localPort = 9444, benchPort = 9223) {
  if (await isPortOpen(localPort)) return;

  // 127.0.0.1 on BOTH ends, NOT localhost: on Windows localhost resolves to ::1
  // first, but the WebView2 CDP endpoint listens on 127.0.0.1 only — a localhost
  // forward target silently reaches nothing.
  execFileSync('ssh', [
    '-fN',
    '-o',
    'ExitOnForwardFailure=yes',
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${benchPort}`,
    ...SSH_OPTS,
    LEGION,
  ]);

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await isPortOpen(localPort)) return;
    await sleep(250);
  }

  throw new Error(`Tunnel to Legion did not open on local port ${localPort}`);
}

export function killApp() {
  sshExec('Stop-Process -Name node,cargo,keepance,Keepance,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 6');
}

export function deleteIndex() {
  sshExec(`if (Test-Path '${WS_KEEPANCE_INDEX}') { Remove-Item -LiteralPath '${WS_KEEPANCE_INDEX}' -Recurse -Force; 'deleted .keepance' } else { '.keepance not present' }`);
}

export function restartApp() {
  sshExec('Start-ScheduledTask KeepanceDev; Start-Sleep 12');
}

export async function waitForPorts(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const command = '(Get-NetTCPConnection -LocalPort 9223 -State Listen -EA SilentlyContinue|Measure-Object).Count; (Get-NetTCPConnection -LocalPort 5173 -State Listen -EA SilentlyContinue|Measure-Object).Count';

  while (Date.now() < deadline) {
    try {
      const output = sshExec(command).trim().split(/\s+/);
      const [cdpPort, previewPort] = output;
      if (cdpPort === '1' && previewPort === '1') return true;
    } catch {
      // Match the shell reset script's quiet retry behavior when SSH has a transient miss.
    }

    if (Date.now() < deadline) await sleep(4000);
  }

  return false;
}
