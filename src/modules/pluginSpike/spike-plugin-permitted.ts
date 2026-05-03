// Plugin Spike - permitted plugin source.
//
// Authored as a plain JavaScript string so it can be posted across the worker
// boundary via `sendInit({ code })` without an extra TypeScript transform
// step. The runtime turns the string into a Blob URL and dynamic-imports it,
// so this string MUST evaluate as an ES module exporting `{ activate }`.
//
// Each command implements one of the 8 spike criteria. Most commands return
// data the host scenario assertions key off; criterion 7 conditionally throws
// based on payload so the host can drive both sync and async failure modes.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

export const SPIKE_PERMITTED_PLUGIN_CODE = `
export async function activate(api, ctx) {
  // Criterion 1 - confirm worker isolation. Both \`document\` and \`window\`
  // must be undefined inside a dedicated worker scope.
  api.commands.register('criterion-1', () => {
    return {
      documentType: typeof document,
      windowType: typeof window,
      hasSelf: typeof self !== 'undefined',
      permissions: ctx.permissions,
    };
  });

  // Criterion 2 - round-trip command. Returns a string the host asserts on.
  api.commands.register('criterion-2', (payload) => {
    const echo = payload && typeof payload === 'object' && 'echo' in payload
      ? String(payload.echo)
      : 'pong';
    return echo;
  });

  // Criterion 3 - permission denial. Calling workspace.readFile must reject
  // with a structured error. The handler captures the rejection and returns
  // the error code/message back to the host.
  api.commands.register('criterion-3', async () => {
    try {
      await api.workspace.readFile('/etc/passwd');
      return { rejected: false };
    } catch (err) {
      return {
        rejected: true,
        code: err && err.code ? err.code : 'no-code',
        message: err && err.message ? err.message : '',
      };
    }
  });

  // Criterion 4 - sidebar panel render. addPanel posts a panel-render message
  // the bridge surfaces to UI subscribers.
  api.commands.register('criterion-4', async () => {
    await api.sidebar.addPanel({
      id: 'spike-panel',
      title: 'Spike Panel',
      html: '<p>hello from the plugin sandbox</p>',
    });
    return { rendered: true };
  });

  // Criterion 5 - host drives the load/unload/reload cycle around this. The
  // command itself just confirms activation completed.
  api.commands.register('criterion-5', () => {
    return { activated: true };
  });

  // Criterion 6 - exercises the editor:selection permission. Permitted plugin
  // succeeds; the denied plugin's identical command fails. The handler
  // surfaces both outcomes uniformly so the host scenario can compare them.
  api.commands.register('criterion-6', async () => {
    try {
      const sel = await api.editor.getSelection();
      return { ok: true, selection: sel };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : 'no-code',
        message: err && err.message ? err.message : '',
      };
    }
  });

  // Criterion 7 - crash isolation. Throws synchronously by default; payload
  // can flip to an async rejection to exercise the unhandled-rejection path.
  api.commands.register('criterion-7', (payload) => {
    const mode = payload && typeof payload === 'object' && 'mode' in payload
      ? String(payload.mode)
      : 'sync';
    if (mode === 'async') {
      return Promise.reject(new Error('async plugin crash'));
    }
    throw new Error('sync plugin crash');
  });

  // Criterion 8 - minimal no-op ping for round-trip latency measurement. Host
  // invokes this 100x and measures performance.now() deltas.
  api.commands.register('criterion-8', () => {
    return 'ok';
  });
}
`;
