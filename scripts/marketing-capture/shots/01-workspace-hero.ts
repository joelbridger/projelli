import { captureStill } from '../lib/capture-still';

export async function shot01() {
  return captureStill({
    shotKey: 'workspaceHero',
    outputName: 'screenshot-01-workspace.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot01().then((p) => console.log(`✓ ${p}`));
}
