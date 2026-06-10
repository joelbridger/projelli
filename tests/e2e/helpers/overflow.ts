import type { Page } from '@playwright/test';

export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) offenders.push(`document ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -8 || r.right > window.innerWidth + 8)) {
        offenders.push(`${el.tagName}.${String(el.className).slice(0, 60)} left=${Math.round(r.left)} right=${Math.round(r.right)}`);
      }
    }
    return offenders.slice(0, 20);
  });
}
