// Plugin Spike - denied plugin source.
//
// Identical shape to the permitted plugin but loaded with NO permissions in
// its manifest. Used exclusively by criterion 6: the host runs the same
// `criterion-6` command on both the permitted plugin (success) and this one
// (permission-denied). The denied plugin's command surfaces the rejection
// structurally so the host can assert on the error code.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

export const SPIKE_DENIED_PLUGIN_CODE = `
export async function activate(api, ctx) {
  // Mirrors criterion-6 from the permitted plugin so the host can issue the
  // same command id and compare outcomes. Without editor:selection the bridge
  // must reject with permission-denied; the handler surfaces that rejection.
  api.commands.register('criterion-6', async () => {
    try {
      const sel = await api.editor.getSelection();
      return { ok: true, selection: sel, permissions: ctx.permissions };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : 'no-code',
        message: err && err.message ? err.message : '',
        permissions: ctx.permissions,
      };
    }
  });
}
`;
