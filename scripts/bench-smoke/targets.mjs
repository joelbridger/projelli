// scripts/bench-smoke/targets.mjs — bench target registry for the smoke harness.
//
// A "target" is a Windows bench reachable over SSH + Tailscale that already has
// the Keepance/lantern-plus desktop app running with WebView2 remote debugging.
// Each target entry is just connection facts — the harness drives every target
// the same way, over the same SSH-invocation pattern as scripts/legion-drive.sh.
//
// Known targets today: the physical Legion laptop, and the first Azure cloud
// Windows bench (coordination/azure-bench/SETUP-LOG.md). Any --host/--user
// override lets a not-yet-registered bench (e.g. a second Azure VM) be driven
// without a code change.

export const TARGETS = {
  legion: {
    id: 'legion',
    label: 'Legion Windows laptop (physical bench)',
    os: 'windows',
    sshUser: 'james',
    sshHost: '100.127.67.22',
    repoDir: 'C:\\lantern-plus',
    appLogPath: 'C:\\tauri-dev.log',
    taskName: 'LanternPlusDev',
    cdpPort: 9223,
    appOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'],
  },
  'azure-cloud-bench-1': {
    id: 'azure-cloud-bench-1',
    label: 'Azure cloud Windows bench (lantern-cloud-bench-1)',
    os: 'windows',
    sshUser: 'lpbench',
    sshHost: '100.75.247.98',
    repoDir: 'C:\\lantern-plus',
    appLogPath: 'C:\\tauri-dev.log',
    taskName: 'LanternDevBench',
    cdpPort: 9223,
    appOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'],
  },
};

export const DEFAULT_TARGET_ID = 'legion';

/** Fallback Windows scheduled-task name for an ad hoc (unregistered) target. */
const DEFAULT_TASK_NAME = 'LanternPlusDev';
const DEFAULT_CDP_PORT = 9223;
const DEFAULT_APP_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'];

/**
 * Resolve a target by id, applying optional connection overrides (--host,
 * --user, --repo-dir). Throws with the list of known ids when the name isn't
 * registered and no full override set (user+host) is given — this lets a
 * brand-new bench be driven ad hoc via `--target custom --host H --user U`.
 */
export function resolveTarget(idOrUndefined, overrides = {}) {
  const id = idOrUndefined || DEFAULT_TARGET_ID;
  const base = TARGETS[id];

  if (!base) {
    if (overrides.host && overrides.user) {
      return {
        id,
        label: `ad hoc target (${id})`,
        os: overrides.os || 'windows',
        sshUser: overrides.user,
        sshHost: overrides.host,
        repoDir: overrides.repoDir || 'C:\\lantern-plus',
        appLogPath: overrides.appLogPath || 'C:\\tauri-dev.log',
        taskName: overrides.taskName || DEFAULT_TASK_NAME,
        cdpPort: Number(overrides.cdpPort || DEFAULT_CDP_PORT),
        appOrigins: overrides.appOrigins || DEFAULT_APP_ORIGINS,
      };
    }
    throw new Error(
      `Unknown bench target "${id}". Known targets: ${Object.keys(TARGETS).join(', ')}. ` +
        `For an unregistered bench, pass --host and --user explicitly.`
    );
  }

  return {
    ...base,
    sshUser: overrides.user || base.sshUser,
    sshHost: overrides.host || base.sshHost,
    repoDir: overrides.repoDir || base.repoDir,
    appLogPath: overrides.appLogPath || base.appLogPath || 'C:\\tauri-dev.log',
    taskName: overrides.taskName || base.taskName || DEFAULT_TASK_NAME,
    cdpPort: Number(overrides.cdpPort || base.cdpPort || DEFAULT_CDP_PORT),
    appOrigins: overrides.appOrigins || base.appOrigins || DEFAULT_APP_ORIGINS,
  };
}

export function listTargets() {
  return Object.values(TARGETS);
}
