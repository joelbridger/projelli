/**
 * 00-workspace-shell.smoke — the canary.
 *
 * Boots the REAL Tauri app, opens a temp workspace, and asserts the main shell
 * renders with a real file read from the real Tauri filesystem. If this fails,
 * the harness itself is broken (not a product bug). Ported from the proven probe.
 */

import fs from 'node:fs';
import path from 'node:path';

export default {
  name: '00-workspace-shell.smoke',
  async run({ session, workspace, app }) {
    // Seed a real file into the real workspace dir on disk.
    fs.writeFileSync(path.join(workspace, 'probe.md'), '# Desktop backend smoke\n');

    await app.bootToWorkspace(session, { workspacePath: workspace });

    // Documents shell + the real file from the Tauri FS.
    await session.testid('documents-files-controls', 15_000);
    await session.testid('documents-tab-strip', 15_000);
    await session.waitForBodyText('probe.md', { timeoutMs: 15_000 });
  },
};
