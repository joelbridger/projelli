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
  await engine.caption('Your clients, all in one place.', 1700);
  await engine.clickTestId('spine-client-row-matter_demo_brennan');
  await engine.clearCaption();
  await engine.waitForTestId('clientmap-tab-household', { timeout: 20000 });
  await engine.hold(900);

  await engine.caption('The Client Map: everything known about a household.', 2100);
  await engine.clearCaption();

  // The trust line: built from their files, nothing leaves the machine.
  const receipt = page.getByTestId('clientmap-build-receipt').first();
  if (await receipt.count()) {
    await engine.moveTo(receipt).catch(() => {});
    await engine.caption('Built from their own emails and files. Nothing leaves your computer.', 2400);
    await engine.hold(500);
    await engine.clearCaption();
  }

  // A fact and where it came from.
  const sourceLink = page.getByTestId('clientmap-source-link').first();
  if (await sourceLink.count()) {
    await engine.moveTo(sourceLink).catch(() => {});
    await engine.caption('Each fact links back to where it came from.', 2100);
    await engine.hold(500);
    await engine.clearCaption();
  }

  // Walk the sections the way an advisor thinks.
  await engine.caption('Grouped the way you think.', 1500);
  await engine.clickTestId('clientmap-tab-goals');
  await engine.hold(1300);
  await engine.clickTestId('clientmap-tab-money');
  await engine.hold(1400);
  await engine.clearCaption();

  // It flags what is still missing.
  const missing = page.getByTestId('clientmap-tab-__missing').first();
  if (await missing.count()) {
    await engine.caption('And it flags what is still missing.', 1800);
    await engine.click(missing);
    await engine.hold(1600);
    await engine.clearCaption();
  }

  await engine.caption('One clear picture of every client.', 2000);
  await engine.hold(500);
  await engine.clearCaption();
}
