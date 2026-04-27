import { captureStill } from '../lib/capture-still';

export async function shot03() {
  return captureStill({
    shotKey: 'wikiLinks',
    outputName: 'screenshot-03-wikilinks.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot03().then((p) => console.log(`✓ ${p}`));
}
