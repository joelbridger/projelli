import { chromium } from 'playwright';

const shots = [
  { file: 'ask-smart-agent.html', out: 'ask-smart-agent.png' },
  { file: 'ask-smart-nothingfound.html', out: 'ask-smart-nothingfound.png' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1360, height: 1100 } });
for (const s of shots) {
  await page.goto('file:///home/jameson/kp-ask-smart/marketing-demo/mockups/' + s.file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // let webfont settle
  await page.screenshot({ path: '/home/jameson/kp-ask-smart/marketing-demo/mockups/' + s.out, fullPage: true });
  console.log('shot', s.out);
}
await browser.close();
