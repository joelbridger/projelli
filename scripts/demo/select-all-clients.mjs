export async function selectAllClientsThroughApp(page) {
  await page.waitForSelector('[data-testid="spine-nav-matters"]', { timeout: 30000 });
  if (!(await page.$('[data-testid="spine-all-clients-row"]'))) {
    await page.click('[data-testid="spine-clients-toggle"]');
  }
  await page.click('[data-testid="spine-all-clients-row"]');
  await page.waitForFunction(() => {
    const matterState = JSON.parse(localStorage.getItem('keepance:matters') || '{}');
    return (matterState?.state?.activeMatterId ?? matterState?.activeMatterId ?? null) === null;
  });
}
