// Read the latest Ask turn (answer + citations) from the current page.
import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const out = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('[data-testid^="ask-citation-chip"]')].map((c) => (c.textContent || '').trim());
  // capture the answer area: find the last occurrence of the question and text after it
  const main = document.querySelector('main') || document.body;
  const lines = main.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
  // grab a window around the last "answered"/citation markers
  const tail = lines.slice(-30);
  return {
    chips,
    answeredOverFiles: /answered over your own|cited (over|from) your/i.test(main.innerText),
    couldntFind: /couldn'?t find anything/i.test(main.innerText),
    answering: /Answering…|Sending to your AI/i.test(main.innerText),
    tail,
  };
});
console.log(JSON.stringify(out, null, 2));
process.exit(0);
