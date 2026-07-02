import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const LEGION = 'james@100.127.67.22';
// Canonical Northcrest demo workspace root on the bench. The RAG index bakes
// ABSOLUTE paths (chunk id = sha256(absolute path)), so a frozen snapshot can
// only be restored back to THIS exact path — never a different temp folder.
export const WS_ROOT = 'C:\\keepance-demo-northcrest\\Northcrest Wealth Partners';
// On-disk vector index for the Northcrest demo workspace. Plain Windows path;
// JS-escaped backslashes only (NOT shell-escaped). Passed inside a PowerShell
// single-quoted string by deleteIndex(), so PowerShell sees C:\...\.lantern.
// The hidden index folder itself was renamed .keepance -> .lantern as part of
// the app's facade rename; the export/const name is kept as-is to avoid
// renaming every import site for a cosmetic label.
export const WS_KEEPANCE_INDEX = `${WS_ROOT}\\.lantern`;

// --- Frozen snapshot locations (the "save point" we restore instead of re-indexing) ---
export const SNAPSHOT_DIR = 'C:\\keepance-snapshots';
export const SNAPSHOT_NAME = 'northcrest-golden';
export const SNAPSHOT_ARCHIVE = `${SNAPSHOT_DIR}\\${SNAPSHOT_NAME}.tar`;
export const SNAPSHOT_MANIFEST = `${SNAPSHOT_DIR}\\${SNAPSHOT_NAME}.manifest.json`;
// The robust PowerShell that does the tar/extract/atomic-swap on the bench.
const SNAPSHOT_PS_REMOTE = 'C:/keepance/robot-snapshot.ps1';
const SNAPSHOT_PS_LOCAL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'bench',
  'snapshot.ps1',
);

const SSH_OPTS = ['-o', 'ConnectTimeout=10'];
// ConnectTimeout above only bounds the SSH HANDSHAKE — once connected, a
// stuck remote command (a locked file the just-killed app hasn't released
// yet, a wedged PowerShell process) blocks execFileSync FOREVER, since
// neither ssh nor execFileSync apply any timeout to the remote command's
// runtime. A CI run silently hung 42+ minutes past its 20-minute
// waitForPorts ceiling because of exactly this — every sshExec /
// runSnapshotAction call below now passes an explicit `timeout` so a genuine
// hang fails loudly within a bounded time instead of running forever.
const DEFAULT_SSH_TIMEOUT_MS = 60_000;

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

// ROBOT_LOCAL: this code is running ON the Legion itself (e.g. a CI runner),
// not on the server driving it remotely. Every sshExec/scpTo/runSnapshotAction
// call used to go over SSH to the Legion's OWN Tailscale IP regardless — a
// pure network loopback for no reason, and a CI run proved it isn't even
// reliable (`spawnSync scp ETIMEDOUT` on a plain file copy, no app or
// workspace involved at all). Run everything as a local child process instead
// when we're already on the target machine.
const IS_LOCAL = () => !!process.env.ROBOT_LOCAL;

export function sshExec(psCommand, timeoutMs = DEFAULT_SSH_TIMEOUT_MS) {
  if (IS_LOCAL()) {
    // pwsh.exe (PowerShell 7), NOT powershell.exe (Windows PowerShell 5.1):
    // the CI workflow's own steps run under `shell: pwsh`, and a 5.1 CHILD
    // spawned under a 7 PARENT (this Node process) inherits a PSModulePath
    // that doesn't resolve 5.1's own built-in module set — Get-FileHash
    // (used deep in the snapshot restore) came back "not recognized" for
    // exactly this reason on the first local-execution CI proof run.
    return execFileSync('pwsh.exe', ['-NoProfile', '-Command', psCommand], { encoding: 'utf8', timeout: timeoutMs });
  }
  return execFileSync('ssh', [...SSH_OPTS, LEGION, psCommand], { encoding: 'utf8', timeout: timeoutMs });
}

export function scpTo(localPath, remotePath) {
  if (IS_LOCAL()) {
    // Both paths are on THIS SAME machine — a plain local copy, no network.
    copyFileSync(localPath, remotePath);
    return;
  }
  execFileSync('scp', [...SSH_OPTS, localPath, `${LEGION}:${remotePath}`], { timeout: DEFAULT_SSH_TIMEOUT_MS });
}

export async function ensureTunnel(localPort = 9444, benchPort = 9223) {
  // ROBOT_LOCAL: the robot is running ON the Windows machine itself (e.g. a CI
  // runner) and drives the local app directly over 127.0.0.1:9223 — no SSH tunnel.
  if (process.env.ROBOT_LOCAL) return;
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
  // The real process name is "lantern" (facade rename) — "keepance"/"Keepance"
  // never matched anything, so this silently failed to kill the app.
  //
  // When ROBOT_LOCAL is set, this pwsh.exe runs as a CHILD of the very
  // node.exe process calling killApp() (this script) — a bare
  // `Stop-Process -Name node` matches by name only, so it would kill its own
  // caller mid-reset, silently truncating everything after this call with no
  // error at all (a CI run stalled on exactly this: the log stopped dead
  // right after "killing the app to release file locks…"). Exclude our own
  // PID from the node kill; cargo/lantern/msedgewebview2 are never node.exe,
  // so no self-conflict there.
  if (IS_LOCAL()) {
    sshExec(
      `Get-Process -Name node -EA SilentlyContinue | Where-Object { $_.Id -ne ${process.pid} } | Stop-Process -Force -EA SilentlyContinue; ` +
      'Stop-Process -Name cargo,lantern,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 6',
    );
    return;
  }
  sshExec('Stop-Process -Name node,cargo,lantern,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 6');
}

export function deleteIndex() {
  sshExec(`if (Test-Path '${WS_KEEPANCE_INDEX}') { Remove-Item -LiteralPath '${WS_KEEPANCE_INDEX}' -Recurse -Force; 'deleted .lantern' } else { '.lantern not present' }`);
}

export function restartApp() {
  sshExec('Start-ScheduledTask KeepanceDev; Start-Sleep 12');
}

// 20 min default (was 90s): a cold Rust rebuild (Legion idle a long time, or
// this is the very first bring-up of a run) can itself take up to ~20 min
// before CDP/Vite ever come up — a 90s ceiling aborted the reset before the
// build even finished, which only went unnoticed because the bench usually
// has a warm cargo cache.
export async function waitForPorts(timeoutMs = 1_200_000) {
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

// ===========================================================================
// Frozen workspace snapshot — archive a fully-indexed workspace once, then
// restore it (over the canonical path) in seconds instead of re-importing and
// re-embedding hundreds of files every run.
//
// Robustness model (defense in depth):
//   1. JS-side fail-safe: never even attempt a restore unless `Status` confirms
//      a non-empty archive exists (assertSnapshotRestorable).
//   2. PS-side atomicity: snapshot.ps1 Restore extracts to a temp dir and only
//      swaps it into place AFTER verifying `.keepance\vectors` is present, so a
//      failed/partial extract can never leave a broken canonical workspace.
//
// Portability: the index keys live in this machine's OS keychain and the index
// bakes absolute paths, so a snapshot is BENCH-BOUND and path-bound — build and
// restore it only on the Legion bench, only to WS_ROOT.
// ===========================================================================

/** PowerShell single-quote a value so spaces/backslashes survive intact. */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Build the single PowerShell command string that runs snapshot.ps1 for one
 * action ('Status' | 'Archive' | 'Restore'). Pure — unit-testable.
 *
 * CRITICAL: the workspace path contains a space ("Northcrest Wealth Partners").
 * ssh joins remote args with spaces into ONE string that the remote shell
 * re-parses, so -Archive/-WsRoot/-File values MUST be PowerShell-quoted here or
 * the path splits on the space (binding -WsRoot to "...\Northcrest" only).
 */
export function buildSnapshotCmd(action, opts = {}) {
  const {
    archive = SNAPSHOT_ARCHIVE,
    wsRoot = WS_ROOT,
    ps = SNAPSHOT_PS_REMOTE,
  } = opts;
  return (
    `powershell -NoProfile -ExecutionPolicy Bypass -File ${psQuote(ps)} ` +
    `-Action ${action} -Archive ${psQuote(archive)} -WsRoot ${psQuote(wsRoot)}`
  );
}

/**
 * Parse snapshot.ps1 output. The script prints human lines then ONE JSON object
 * on the final non-empty line; we parse that. Pure + total (never throws).
 */
export function parseSnapshotResult(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'no output', raw };
  const lines = raw.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{')) {
      try { return JSON.parse(lines[i]); } catch { /* keep scanning upward */ }
    }
  }
  return { ok: false, error: 'no JSON in snapshot output', raw };
}

/**
 * FAIL-SAFE. Throw unless `status` proves a usable golden archive exists.
 * Callers must run this BEFORE any destructive restore so we can never wipe the
 * live workspace when there is nothing to put back.
 */
export function assertSnapshotRestorable(status) {
  if (!status || status.ok !== true) {
    throw new Error(
      `refusing to restore snapshot: status check failed — ${(status && status.error) || 'no status'}`,
    );
  }
  if (status.exists !== true) {
    throw new Error(`refusing to restore snapshot: archive not found at ${SNAPSHOT_ARCHIVE}`);
  }
  if (typeof status.archiveBytes === 'number' && status.archiveBytes <= 0) {
    throw new Error('refusing to restore snapshot: archive is empty (0 bytes)');
  }
  return true;
}

/**
 * Build the snapshot manifest object written alongside the archive. Pure.
 */
export function buildManifest(meta = {}) {
  return {
    name: SNAPSHOT_NAME,
    version: meta.version ?? 1,
    createdAt: meta.createdAt ?? null,
    workspacePath: WS_ROOT,
    archivePath: SNAPSHOT_ARCHIVE,
    archiveBytes: meta.archiveBytes ?? null,
    sha256: meta.sha256 ?? null,
    indexVersion: meta.indexVersion ?? null,
    mattersCount: meta.mattersCount ?? null,
    demoDataCommit: meta.demoDataCommit ?? null,
    note:
      'BENCH-BOUND: the SQLCipher/vector keys live in this machine\'s OS keychain, ' +
      'and the index bakes absolute paths. Restore ONLY on the Legion bench, ONLY to workspacePath.',
  };
}

/** Copy the snapshot PowerShell up to the bench (idempotent; cheap). */
export function scpSnapshotPs() {
  scpTo(SNAPSHOT_PS_LOCAL, SNAPSHOT_PS_REMOTE);
}

// Archive/restore does real file I/O (tar a ~75MB workspace over SSH) — more
// generous than the general default, but still bounded so a genuinely stuck
// extraction (e.g. a file handle the just-killed app hasn't released yet)
// fails loudly instead of hanging the whole reset indefinitely.
const SNAPSHOT_ACTION_TIMEOUT_MS = 600_000;

/** Run one snapshot.ps1 action over ssh and return the parsed result packet. */
function runSnapshotAction(action, opts = {}) {
  let raw = '';
  let threw = false;
  try {
    if (IS_LOCAL()) {
      // buildSnapshotCmd's STRING literally starts with "powershell" (for the
      // remote-ssh path, where the remote shell resolves it from PATH) —
      // feeding that string to `pwsh.exe -Command` would spawn ANOTHER
      // nested "powershell" (Windows PowerShell 5.1) child, reintroducing
      // the exact PSModulePath problem pwsh.exe was chosen to avoid. Invoke
      // pwsh.exe directly with real argv instead — no string, no nesting,
      // no ambiguity about which PowerShell version actually runs the
      // Archive/Restore action.
      const { archive = SNAPSHOT_ARCHIVE, wsRoot = WS_ROOT, ps = SNAPSHOT_PS_REMOTE } = opts;
      raw = execFileSync(
        'pwsh.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Action', action, '-Archive', archive, '-WsRoot', wsRoot],
        { encoding: 'utf8', timeout: SNAPSHOT_ACTION_TIMEOUT_MS },
      );
    } else {
      raw = execFileSync('ssh', [...SSH_OPTS, LEGION, buildSnapshotCmd(action, opts)], { encoding: 'utf8', timeout: SNAPSHOT_ACTION_TIMEOUT_MS });
    }
  } catch (e) {
    // PowerShell -File exits non-zero on a guarded refusal; still capture stdout.
    threw = true;
    raw = `${(e.stdout || '').toString()}\n${(e.stderr || '').toString()}`;
  }
  const result = parseSnapshotResult(raw);
  // Don't trust an `ok:true` JSON if the remote process actually exited non-zero
  // (e.g. emitted ok then a later step / SSH transport failed). Fail closed.
  if (threw && result.ok === true) {
    return { ...result, ok: false, exitError: true, error: result.error || 'remote process exited non-zero after reporting ok' };
  }
  return result;
}

/** Query whether a usable golden archive exists on the bench. */
export function snapshotStatus(opts = {}) {
  return runSnapshotAction('Status', opts);
}

/** Create/overwrite the golden archive from the current canonical workspace. */
export function archiveWorkspace(opts = {}) {
  scpSnapshotPs();
  return runSnapshotAction('Archive', opts);
}

/**
 * Restore the canonical workspace from the golden archive. Guards FIRST:
 * refuses (throws) unless a valid archive exists, so we never destroy the live
 * workspace with nothing to restore.
 */
export function restoreSnapshot(opts = {}) {
  scpSnapshotPs();
  const status = snapshotStatus(opts);
  assertSnapshotRestorable(status);
  return runSnapshotAction('Restore', opts);
}
