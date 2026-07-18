/**
 * V04 — Workflow templates (30s)
 *
 * Customer Discovery Interview workflow run.
 *
 * Timing:
 *   t=0-3s:  Workflow gallery view (sidebar tab + panel visible)
 *   t=3-6s:  Click "Customer Discovery Interview" template
 *   t=6-12s: Question 1 of 10 — text appears, type a brief answer
 *   t=12-15s: Click "Next" → Question 2 appears
 *   t=15-22s: Skip ahead to Question 4 (inject DOM fast-forward)
 *   t=22-26s: Click "Generate" → output document appears
 *   t=26-30s: Hold on final markdown output
 *
 * Workflow execution is React-local. We use DOM injection for all workflow UI states.
 */

import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { renderCinematic, wideCrop, type CameraShot, type Caption } from '../lib/cinematic';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video-04');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const WORKFLOW_OUTPUT = `# Customer Discovery Interview
## Summary — Apr 27, 2026

**Participant:** Engineer-founder, Series A AI infra startup

---

### Key pain points
1. Writing investor updates takes 90 minutes per session.
2. Grammar corrections distract from the message.
3. Needs tone presets: formal for board, casual for co-founders.

### Quotes
> "I write three updates a month and each one takes me ninety minutes."

### Signals
- Strong pull toward tone-aware suggestions.
- Willing to pay Pro tier if it saves 60+ min/week.
- Prefers keyboard-only workflow.

### Next steps
- [ ] Demo tone presets feature in next session
- [ ] Propose beta access at $0 for first 30 days
`;

export async function video04() {
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });

  const browser = await chromium.launch(withBrowserLaunchOptions({
    args: ['--force-device-scale-factor=2', '--high-dpi-support=1'],
  }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_TMP, size: { width: 3840, height: 2160 } },
  });
  const page = await context.newPage();
  const recordingStartMs = Date.now();
  const elapsedSec = () => (Date.now() - recordingStartMs) / 1000;
  const beats: Record<string, number> = {};

  await page.goto('http://localhost:5175/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });
  beats.pageReady = elapsedSec();

  // ── t=0-3s: Seed workspaceHero, then switch to workflows panel ──
  await seedState(page, linterlyFixture, 'workspaceHero');

  // Try to click the workflows sidebar tab
  const wfTab = page.locator('[data-testid="sidebar-tab-workflows"]');
  const wfTabBB = await wfTab.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (wfTabBB) {
    await page.mouse.move(wfTabBB.x + wfTabBB.width / 2, wfTabBB.y + wfTabBB.height / 2, { steps: 8 });
    await page.mouse.click(wfTabBB.x + wfTabBB.width / 2, wfTabBB.y + wfTabBB.height / 2);
    await page.waitForSelector('[data-testid="workflows-panel"]', { timeout: 3000 }).catch(() => null);
  }
  await sleep(3000);
  beats.galleryShown = elapsedSec();

  // ── t=3-6s: Inject workflow gallery overlay (templates view) ──
  // Since real workflow panel may vary, overlay a polished gallery.
  await page.evaluate(() => {
    if (document.getElementById('__v04_wf_gallery')) return;

    const style = document.createElement('style');
    style.id = '__v04_wf_style';
    style.textContent = `
      #__v04_wf_gallery {
        position: fixed; inset: 0; z-index: 200;
        background: var(--background, #0f0f17);
        display: flex; flex-direction: column;
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
        padding: 24px 32px;
        overflow: hidden;
      }
      .v04-gallery-title {
        font-size: 20px; font-weight: 700;
        color: rgba(255,255,255,0.9);
        margin-bottom: 6px;
      }
      .v04-gallery-sub {
        font-size: 13px; color: rgba(255,255,255,0.45);
        margin-bottom: 20px;
      }
      .v04-grid {
        display: grid; grid-template-columns: repeat(3,1fr); gap: 12px;
      }
      .v04-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px; padding: 14px 16px;
        cursor: pointer; transition: border-color 0.15s, background 0.15s;
      }
      .v04-card.highlight {
        border-color: rgba(0,122,255,0.6);
        background: rgba(0,122,255,0.08);
      }
      .v04-card-icon {
        font-size: 22px; margin-bottom: 8px;
      }
      .v04-card-title {
        font-size: 13px; font-weight: 600;
        color: rgba(255,255,255,0.85); margin-bottom: 4px;
      }
      .v04-card-desc {
        font-size: 11px; color: rgba(255,255,255,0.4);
        line-height: 1.5;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = '__v04_wf_gallery';

    const title = document.createElement('div');
    title.className = 'v04-gallery-title';
    title.textContent = 'Workflow Templates';
    overlay.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'v04-gallery-sub';
    sub.textContent = '12 founder-focused workflows — run one to generate a document.';
    overlay.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'v04-grid';

    const templates = [
      { icon: '🎤', name: 'Customer Discovery Interview', desc: '10-question script + summary doc', highlight: true },
      { icon: '🚀', name: 'Launch Checklist', desc: '8-week pre-launch task tracker' },
      { icon: '📊', name: 'Investor Update', desc: 'MRR · runway · asks · narrative' },
      { icon: '🗺️', name: 'Competitive Analysis', desc: 'Feature matrix + positioning map' },
      { icon: '📝', name: 'Brand Voice Guide', desc: 'Tone rules · banned words · examples' },
      { icon: '💬', name: 'Job Description', desc: 'Role · responsibilities · culture fit' },
    ];

    for (const t of templates) {
      const card = document.createElement('div');
      card.className = `v04-card${t.highlight ? ' highlight' : ''}`;
      if (t.highlight) card.id = '__v04_cdi_card';
      const icon = document.createElement('div');
      icon.className = 'v04-card-icon';
      icon.textContent = t.icon;
      const cardTitle = document.createElement('div');
      cardTitle.className = 'v04-card-title';
      cardTitle.textContent = t.name;
      const desc = document.createElement('div');
      desc.className = 'v04-card-desc';
      desc.textContent = t.desc;
      card.appendChild(icon);
      card.appendChild(cardTitle);
      card.appendChild(desc);
      grid.appendChild(card);
    }
    overlay.appendChild(grid);
    document.body.appendChild(overlay);
  });
  await sleep(3000);

  beats.templateClicked = elapsedSec();
  // ── t=3-6s: Click the Customer Discovery Interview card ──
  const cdiCard = page.locator('#__v04_cdi_card');
  const cdiCardBB = await cdiCard.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (cdiCardBB) {
    await page.mouse.move(cdiCardBB.x + cdiCardBB.width / 2, cdiCardBB.y + cdiCardBB.height / 2, { steps: 8 });
    await page.mouse.click(cdiCardBB.x + cdiCardBB.width / 2, cdiCardBB.y + cdiCardBB.height / 2);
  }
  // Remove gallery overlay, show Q1 form
  await page.evaluate(() => {
    const gallery = document.getElementById('__v04_wf_gallery');
    if (gallery) gallery.remove();
    const style = document.getElementById('__v04_wf_style');
    if (style) style.remove();
  });
  await sleep(500);

  // ── t=6-12s: Show Question 1 form ──
  await page.evaluate(() => {
    if (document.getElementById('__v04_wf_form')) return;

    const style = document.createElement('style');
    style.id = '__v04_form_style';
    style.textContent = `
      #__v04_wf_form {
        position: fixed; inset: 0; z-index: 200;
        background: var(--background, #0f0f17);
        display: flex; flex-direction: column;
        font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
        padding: 32px 40px;
      }
      .v04-form-progress {
        font-size: 11px; color: rgba(255,255,255,0.4);
        font-weight: 600; letter-spacing: 0.06em;
        text-transform: uppercase; margin-bottom: 6px;
      }
      .v04-form-title {
        font-size: 22px; font-weight: 700;
        color: rgba(255,255,255,0.9); margin-bottom: 6px;
      }
      .v04-form-q {
        font-size: 15px; color: rgba(255,255,255,0.7);
        margin-bottom: 16px; line-height: 1.5;
      }
      .v04-form-answer {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 14px; color: rgba(255,255,255,0.85);
        min-height: 80px; line-height: 1.6;
        white-space: pre-wrap;
      }
      .v04-form-answer.active {
        border-color: rgba(0,122,255,0.5);
      }
      .v04-form-footer {
        margin-top: 20px; display: flex; gap: 10px; align-items: center;
      }
      .v04-btn {
        padding: 8px 18px; border-radius: 6px;
        font-size: 13px; font-weight: 600; cursor: pointer;
        border: none; transition: opacity 0.15s;
      }
      .v04-btn-primary {
        background: #007AFF; color: #fff;
      }
      .v04-btn-secondary {
        background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
      }
      .v04-progress-bar {
        height: 3px; background: rgba(255,255,255,0.08);
        border-radius: 2px; margin-bottom: 24px; overflow: hidden;
      }
      .v04-progress-fill {
        height: 100%; background: #007AFF;
        border-radius: 2px; transition: width 0.4s ease;
      }
    `;
    document.head.appendChild(style);

    const form = document.createElement('div');
    form.id = '__v04_wf_form';

    const progress = document.createElement('div');
    progress.className = 'v04-form-progress';
    progress.textContent = 'Customer Discovery Interview  ·  Question 1 of 10';
    form.appendChild(progress);

    const progressBar = document.createElement('div');
    progressBar.className = 'v04-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'v04-progress-fill';
    progressFill.id = '__v04_progress_fill';
    progressFill.style.width = '10%';
    progressBar.appendChild(progressFill);
    form.appendChild(progressBar);

    const title = document.createElement('div');
    title.className = 'v04-form-title';
    title.textContent = 'Customer Discovery Interview';
    form.appendChild(title);

    const question = document.createElement('div');
    question.className = 'v04-form-q';
    question.id = '__v04_question';
    question.textContent = 'Q1: Tell me about a recent time you had to communicate progress to investors or stakeholders. What was hard about it?';
    form.appendChild(question);

    const answer = document.createElement('div');
    answer.className = 'v04-form-answer active';
    answer.id = '__v04_answer';
    answer.textContent = '';
    form.appendChild(answer);

    const footer = document.createElement('div');
    footer.className = 'v04-form-footer';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'v04-btn v04-btn-primary';
    nextBtn.id = '__v04_next_btn';
    nextBtn.textContent = 'Next →';
    const skipBtn = document.createElement('button');
    skipBtn.className = 'v04-btn v04-btn-secondary';
    skipBtn.textContent = 'Skip';
    footer.appendChild(nextBtn);
    footer.appendChild(skipBtn);
    form.appendChild(footer);

    document.body.appendChild(form);
  });
  await sleep(500);

  // Type an answer char-by-char into the fake answer div
  const ANSWER_TEXT = 'Writing investor updates takes about 90 minutes each time — mostly spent on getting the tone right.';
  for (let i = 0; i <= ANSWER_TEXT.length; i++) {
    await page.evaluate(
      ({ text }) => {
        const el = document.getElementById('__v04_answer');
        if (el) el.textContent = text;
      },
      { text: ANSWER_TEXT.slice(0, i) },
    );
    await sleep(55);
  }
  await sleep(800);

  // ── t=12-15s: Click "Next" → Question 2 ──
  const nextBtn = page.locator('#__v04_next_btn');
  const nextBB = await nextBtn.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (nextBB) {
    await page.mouse.move(nextBB.x + nextBB.width / 2, nextBB.y + nextBB.height / 2, { steps: 8 });
    await page.mouse.click(nextBB.x + nextBB.width / 2, nextBB.y + nextBB.height / 2);
  }
  await page.evaluate(() => {
    const q = document.getElementById('__v04_question');
    if (q) q.textContent = 'Q2: What does your current writing process look like? Which tools do you use?';
    const a = document.getElementById('__v04_answer');
    if (a) a.textContent = '';
    const prog = document.querySelector('.v04-form-progress');
    if (prog) prog.textContent = 'Customer Discovery Interview  ·  Question 2 of 10';
    const fill = document.getElementById('__v04_progress_fill');
    if (fill) fill.style.width = '20%';
  });
  await sleep(3000);

  // ── t=15-22s: Fast-forward to Question 4 ──
  await page.evaluate(() => {
    const q = document.getElementById('__v04_question');
    if (q) q.textContent = 'Q4: If Linterly could save you 60 minutes per update, would that change how often you write?';
    const a = document.getElementById('__v04_answer');
    if (a) a.textContent = "Absolutely — I’d write more frequently and with less stress.";
    const prog = document.querySelector('.v04-form-progress');
    if (prog) prog.textContent = 'Customer Discovery Interview  ·  Question 4 of 10';
    const fill = document.getElementById('__v04_progress_fill');
    if (fill) fill.style.width = '40%';
    // Change Next to Generate on last visible question
    const nextBtnEl = document.getElementById('__v04_next_btn');
    if (nextBtnEl) nextBtnEl.textContent = 'Generate ✦';
  });
  await sleep(7000);

  beats.generateClicked = elapsedSec();
  // ── t=22-26s: Click "Generate" → output doc appears ──
  const genBtn = page.locator('#__v04_next_btn');
  const genBB = await genBtn.first().boundingBox({ timeout: 1000 }).catch(() => null);
  if (genBB) {
    await page.mouse.move(genBB.x + genBB.width / 2, genBB.y + genBB.height / 2, { steps: 8 });
    await page.mouse.click(genBB.x + genBB.width / 2, genBB.y + genBB.height / 2);
  }
  // Replace form with markdown output
  await page.evaluate(
    ({ output }) => {
      const form = document.getElementById('__v04_wf_form');
      if (form) form.remove();
      const style = document.getElementById('__v04_form_style');
      if (style) style.remove();

      const outputStyle = document.createElement('style');
      outputStyle.id = '__v04_out_style';
      outputStyle.textContent = `
        #__v04_output {
          position: fixed; inset: 0; z-index: 200;
          background: var(--background, #0f0f17);
          display: flex; flex-direction: column;
          font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
          animation: __v04fadein 0.4s ease forwards;
        }
        @keyframes __v04fadein { from { opacity:0; } to { opacity:1; } }
        .v04-out-header {
          height: 40px; background: rgba(255,255,255,0.03);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; padding: 0 16px;
          font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.6);
          gap: 8px; flex-shrink: 0;
        }
        .v04-out-badge {
          background: rgba(52,199,89,0.15); color: #34C759;
          border: 1px solid rgba(52,199,89,0.3);
          border-radius: 4px; padding: 1px 7px; font-size: 11px; font-weight: 600;
        }
        .v04-out-body {
          flex: 1; overflow: auto; padding: 24px 32px;
          font-size: 14px; line-height: 1.7; color: rgba(255,255,255,0.8);
          white-space: pre-wrap;
        }
        .v04-out-body h1, .v04-out-body h2, .v04-out-body h3 {
          color: rgba(255,255,255,0.95); margin: 1.2em 0 0.4em;
        }
      `;
      document.head.appendChild(outputStyle);

      const outWrap = document.createElement('div');
      outWrap.id = '__v04_output';
      const header = document.createElement('div');
      header.className = 'v04-out-header';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = 'Customer Discovery Interview.md';
      const badge = document.createElement('span');
      badge.className = 'v04-out-badge';
      badge.textContent = '✓ Generated';
      header.appendChild(nameSpan);
      header.appendChild(badge);
      outWrap.appendChild(header);

      const body = document.createElement('pre');
      body.className = 'v04-out-body';
      body.textContent = output;
      outWrap.appendChild(body);
      document.body.appendChild(outWrap);
    },
    { output: WORKFLOW_OUTPUT },
  );
  await sleep(4000);
  beats.outputShown = elapsedSec();

  // ── t=26-30s: Hold final state ──
  await sleep(4000);
  beats.end = elapsedSec();

  await page.close();
  await context.close();
  await browser.close();

  const webms = readdirSync(VIDEO_TMP)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, mtime: statSync(path.join(VIDEO_TMP, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error('No .webm produced');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'workflow-templates.mp4');

  console.log('[V04] beats:', JSON.stringify(beats));

  // All overlays are full-viewport `position: fixed; inset: 0`, so the
  // camera stays wide for the whole video — no productive zoom target.
  const shots: CameraShot[] = [
    { tSec: 0,                              crop: wideCrop(), label: 'wide' },
    { tSec: (beats.end ?? 30),              crop: wideCrop(), label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.galleryShown ?? 3) + 0.3,    endSec: (beats.templateClicked ?? 6) - 0.2, text: 'Pick a workflow' },
    { startSec: (beats.templateClicked ?? 6) + 0.5, endSec: (beats.generateClicked ?? 22) - 0.5, text: 'Answer a few questions' },
    { startSec: (beats.outputShown ?? 26) + 0.5,    endSec: (beats.end ?? 30) - 0.2, text: 'Get a finished document' },
  ];

  const PRE_ROLL_SEC = 0.4;
  const trimSec = Math.max(0, (beats.galleryShown ?? 3) - 0.5 - PRE_ROLL_SEC);

  await renderCinematic({ webmPath, chromePngPath: CHROME_PNG, outPath, shots, captions, trimSec, videoTitle: 'Run a workflow, get a finished doc' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'workflow-templates.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'workflow-templates.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video04().catch((e) => { console.error(e); process.exit(1); });
}
