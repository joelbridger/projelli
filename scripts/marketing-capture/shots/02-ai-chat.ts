import { captureStill } from '../lib/capture-still';

export async function shot02() {
  return captureStill({
    shotKey: 'aiMidStream',
    outputName: 'screenshot-02-ai-chat.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
    aiReplay: 'launch-plan-stream',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot02().then((p) => console.log(`✓ ${p}`));
}
