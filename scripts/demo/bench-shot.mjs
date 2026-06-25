import { getPage } from '../robot/connection.mjs';
const OUT = process.argv[2] || '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad/bench.png';
const page = await getPage();
await page.screenshot({ path: OUT });
console.log('shot ->', OUT, '| url:', page.url());
process.exit(0);
