import { getPage } from '../robot/connection.mjs';
const page = await getPage();
const res = await page.evaluate(() => {
  const out = { winKeys: [], zustandLike: [], testHooks: [], activeMatterId: null };
  for (const k of Object.keys(window)) {
    if (/keepance|store|matter|__|test|debug|zustand/i.test(k)) out.winKeys.push(k);
  }
  // look for objects exposing getState/setState
  for (const k of Object.keys(window)) {
    try {
      const v = window[k];
      if (v && typeof v === 'object' && typeof v.getState === 'function') {
        out.zustandLike.push(k);
      }
    } catch {}
  }
  // common test handles
  for (const k of ['__KEEPANCE__', '__keepance', '__stores', 'useMatterStore', '__matterStore', 'keepanceTest', '__TEST__']) {
    if (window[k]) out.testHooks.push(k);
  }
  return out;
});
console.log(JSON.stringify(res, null, 2));
process.exit(0);
