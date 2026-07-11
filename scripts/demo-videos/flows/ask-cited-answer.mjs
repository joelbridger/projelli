/**
 * Flow: ask-cited-answer
 *
 * The flagship feature video. An advisor asks a plain question about a
 * household and gets an answer that is grounded in that household's own files,
 * with every claim carrying a source. Drives the REAL app (dev build) with the
 * built-in advisor sample household (the Hendricks) active, so the cited answer
 * is served locally with no cloud key — deterministic every run.
 *
 *   node scripts/demo-videos/record.mjs ask-cited-answer
 *
 * Captions use plain household language, no time promises, no em dashes.
 */

export const meta = {
  title: 'Ask a question, get a cited answer',
  viewport: { width: 1280, height: 800 },
};

const ROTH_QUESTION = 'What did we decide about the Roth conversion?';

export default async function run(engine, { page }) {
  // Land in the sample household's private workspace (opens on its Client Map).
  await engine.goto('/?testMode=true&seedSample=1');
  await engine.hold(1200);
  const askNav = page.getByTestId('spine-nav-search');
  await engine.caption('Meet the Hendricks sample household.', 1900, {
    target: askNav,
  });
  await engine.clearCaption();

  // Open Ask.
  await engine.caption('Ask a plain question about them.', 1500, { target: askNav });
  await engine.click(askNav);
  await engine.clearCaption();
  await engine.waitForTestId('ask-thread-scroll');
  await engine.hold(700);

  // The app offers ready-made questions; pick the Roth conversion one.
  const rothBtn = page
    .getByTestId('ask-demo-question')
    .filter({ hasText: /Roth/i })
    .first();
  await engine.caption('Choose a ready-made question.', 1900, {
    target: rothBtn,
  });
  await engine.clearCaption();

  // Explain the promise before revealing the answer, so the huge caption never
  // hides the answer itself.
  await engine.caption('It answers only from their own files.', 1500, {
    target: rothBtn,
  });
  await engine.clearCaption();
  await engine.moveTo(rothBtn);
  await engine.click(rothBtn);

  // Answer appears, grounded in the household's own files.
  await engine.waitForTestId('ask-answer-receipt', { timeout: 20000 });
  await page
    .getByTestId('ask-cited-attestation')
    .first()
    .waitFor({ state: 'visible', timeout: 6000 })
    .catch(() => {});
  await engine.hold(1300);
  await engine.clearCaption();

  // Point at a citation on the answer without obscuring the result.
  await engine
    .moveTo(page.getByTestId('ask-citation-chip-1').first())
    .catch(() => {});
  await engine.hold(800);
  await engine.clearCaption();

  // Reveal the source panel so the exact passage is visible.
  const sourcesToggle = page.getByTestId('ask-sources-toggle').first();
  if (await sourcesToggle.count()) {
    await engine.caption('Open the sources to read the exact words.', 1600, {
      target: sourcesToggle,
    });
    await engine.clearCaption();
    await engine.click(sourcesToggle).catch(() => {});
    await engine.hold(2100);
  }

  // The composer lives low in the frame, so this caption deliberately moves
  // to the top edge. It demonstrates the same dodge rule a real walkthrough
  // needs when describing a bottom-of-screen control.
  const composer = page.getByTestId('ask-composer-input');
  if (await composer.count()) {
    await engine.caption('You can keep asking from here.', 1600, {
      target: composer,
    });
    await engine.clearCaption();
  }
}
