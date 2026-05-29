/**
 * S04 — Templates gallery
 *
 * Goal: Workflow panel visible in sidebar, showing the gallery of workflow
 * cards, with a "Customer Discovery · Step 4 of 10" execution indicator.
 *
 * currentExecution is React local state in App.tsx so it can't be seeded
 * via Zustand. We use two approaches:
 *   1. Click `sidebar-tab-workflows` to surface the workflows panel.
 *   2. Inject a DOM node that mimics the "Current Execution" card so the
 *      shot shows the mid-run visual even though no workflow is running.
 */

import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

async function beforeShot(page: Page): Promise<void> {
  // 1. Switch sidebar to the Workflows tab.
  await page.click('[data-testid="sidebar-tab-workflows"]');
  // Wait for the workflow panel to paint.
  await page.waitForSelector('[data-testid="workflows-panel"]', { timeout: 5000 });

  // 2. Append a "Current Run" card to the bottom of the scrollable panel
  //    using safe DOM construction (no innerHTML/eval).
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="workflows-panel"]');
    if (!panel) return;
    const scrollArea = panel.querySelector('.overflow-y-auto');
    if (!scrollArea) return;

    // Spin animation
    if (!document.getElementById('__s04_spin_style')) {
      const style = document.createElement('style');
      style.id = '__s04_spin_style';
      style.textContent =
        '@keyframes __s04spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    // Wrapper section
    const section = document.createElement('div');
    section.id = '__s04_execution_overlay';
    section.style.cssText = 'margin-top: 16px;';

    const heading = document.createElement('h3');
    heading.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 12px;';
    heading.textContent = 'Current Run';

    // Card
    const card = document.createElement('div');
    card.style.cssText = [
      'border: 1px solid rgba(128,128,128,0.3)',
      'border-radius: 8px',
      'padding: 12px',
      'cursor: pointer',
      'background: var(--card, #fff)',
    ].join('; ');

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    // Spinner via SVG
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.style.cssText = 'animation: __s04spin 1s linear infinite; color: #f59e0b; flex-shrink: 0;';

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '4');
    circle.setAttribute('opacity', '0.25');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z');
    path.setAttribute('opacity', '0.75');

    svg.appendChild(circle);
    svg.appendChild(path);

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'flex: 1; min-width: 0;';

    const title = document.createElement('span');
    title.style.cssText =
      'font-size: 14px; font-weight: 500; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    title.textContent = 'Customer Discovery Interview';

    const sub = document.createElement('span');
    sub.style.cssText = 'font-size: 12px; opacity: 0.6;';
    sub.textContent = 'Step 4 of 10 — click to view';

    textWrap.appendChild(title);
    textWrap.appendChild(sub);
    row.appendChild(svg);
    row.appendChild(textWrap);
    card.appendChild(row);
    section.appendChild(heading);
    section.appendChild(card);
    scrollArea.appendChild(section);
  });

  // One extra settle frame.
  await page.waitForTimeout(200);
}

export async function shot04() {
  return captureStill({
    shotKey: 'templates',
    outputName: 'screenshot-04-templates.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Keepance',
    beforeShot,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot04().then((p) => console.log(`✓ ${p}`));
}
