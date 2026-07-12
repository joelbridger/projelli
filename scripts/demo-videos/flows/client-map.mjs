/**
 * Flow: client-map
 *
 * Shows the Client Map: a single, organised picture of everything the practice
 * knows about a household, built from its own emails and files, where every
 * fact links back to where it came from and gaps are flagged. Drives the REAL
 * app (dev build) with the seeded advisor book (the Brennan household has a
 * fully built map).
 *
 *   node scripts/demo-videos/record.mjs client-map
 */

export const meta = {
  title: 'The Client Map',
  viewport: { width: 1280, height: 800 },
};

export default async function run(engine, { page }) {
  await engine.goto('/?testMode=true&seedDemo=1');
  await engine.hold(1100);

  // Open a client from the list.
  const brennanRow = page.getByTestId('spine-client-row-matter_demo_brennan');
  await engine.caption('Your clients, all in one place.', 1700, {
    target: brennanRow,
  });
  await engine.clearCaption();
  await engine.click(brennanRow);
  await engine.waitForTestId('clientmap-tab-household', { timeout: 20000 });
  await engine.hold(900);

  // The trust line: built from their files, nothing leaves the machine.
  const receipt = page.getByTestId('clientmap-build-receipt').first();
  if (await receipt.count()) {
    await engine.caption('Built from their files. It stays on this computer.', 2400, {
      target: receipt,
    });
    await engine.clearCaption();
    await engine.moveTo(receipt).catch(() => {});
    await engine.hold(500);
  }

  // A fact and where it came from.
  const sourceLink = page.getByTestId('clientmap-source-link').first();
  if (await sourceLink.count()) {
    await engine.caption('Every fact links to its source.', 2100, {
      target: sourceLink,
    });
    await engine.clearCaption();
    await engine.moveTo(sourceLink).catch(() => {});
    await engine.hold(500);
  }

  // Walk the sections the way an advisor thinks.
  const goalsTab = page.getByTestId('clientmap-tab-goals');
  await engine.caption('Grouped the way you think.', 1500, { target: goalsTab });
  await engine.clearCaption();
  await engine.click(goalsTab);
  await engine.hold(1300);
  await engine.clickTestId('clientmap-tab-money');
  await engine.hold(1400);

  // This row sits below the fold midpoint, so the caption moves to the top
  // and leaves the action visible underneath.
  const addFact = page.getByTestId('clientmap-add-fact-row').first();
  if (await addFact.count()) {
    await engine.caption('Add a fact whenever you learn something new.', 1600, {
      target: addFact,
    });
    await engine.clearCaption();
  }

  // It flags what is still missing.
  const missing = page.getByTestId('clientmap-tab-__missing').first();
  if (await missing.count()) {
    await engine.caption('And it flags what is still missing.', 1800, {
      target: missing,
    });
    await engine.clearCaption();
    await engine.click(missing);
    await engine.hold(1600);
  }
}
