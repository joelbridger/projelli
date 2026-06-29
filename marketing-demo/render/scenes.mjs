/*
 * marketing-demo/render/scenes.mjs
 * DEMO-ONLY scene choreography for the Keepance marketing demo video.
 * Each scene is an async function (page, ctx) that drives the injected stage
 * engine (window.__kp) and/or the real app. Timings target the storyboard.
 *
 * Scenes 1-4 and 7 are scripted overlays (simulated, styled native).
 * Scenes 5-6 drive the REAL app (Client Map + Ask) and live in realScenes.mjs.
 */

// ---- small node-side helpers ----
export const VIEW = { width: 1440, height: 900 };

// run a function in the page; thin wrapper for readability
const ev = (page, fn, ...args) => page.evaluate(fn, ...args);

// SVG icon set (inline, trusted)
const ICON = {
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  shield: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  lock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8"/></svg>`,
  user: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  chart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  scale: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5a3 3 0 0 0 5 0L5 8zm14 0l-2.5 5a3 3 0 0 0 5 0L19 8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  calc: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  briefcase: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="1.7"/></svg>`,
  doc: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7"/></svg>`,
  mail: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.7"/></svg>`,
  note: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  mic: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  database: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.7"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" stroke="currentColor" stroke-width="1.7"/></svg>`,
  spark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
};

const STEP_PIPS = (active, total = 4) =>
  `<div class="kpd-steps">${Array.from({ length: total }, (_, i) =>
    `<div class="kpd-pip${i <= active ? ' on' : ''}"></div>`).join('')}</div>`;

// =====================================================================
// SCENE 1 — Cold open / the pain
// =====================================================================
export async function sceneColdOpen(page) {
  const drifts = [
    { l: '10%', t: '20%', r: -8, tag: '401(k).pdf', d: 0 },
    { l: '74%', t: '16%', r: 7, tag: 'email · re: rollover', d: 0.6 },
    { l: '16%', t: '64%', r: 5, tag: 'review notes', d: 1.1 },
    { l: '68%', t: '66%', r: -6, tag: 'beneficiary form', d: 0.3 },
    { l: '44%', t: '12%', r: 3, tag: 'voicemail · Marcus', d: 0.9 },
    { l: '40%', t: '74%', r: -4, tag: '529 statement', d: 1.4 },
  ];
  const driftHTML = drifts.map((c) =>
    `<div class="kpd-drift" style="left:${c.l};top:${c.t};--r:${c.r}deg;transform:rotate(${c.r}deg);animation:kpd-float ${5 + c.d}s ease-in-out ${c.d}s infinite">
       <div class="kpd-drift-tag">${c.tag}</div>
       <div class="kpd-drift-line"></div><div class="kpd-drift-line s"></div>
     </div>`).join('');

  const html = `<div class="kpd-scene"><div class="kpd-fullcard">
    <div class="kpd-grain"></div>
    ${driftHTML}
    <div class="kpd-headline" id="kpd-co-h">Client context is scattered across files,<br>emails, notes, and old conversations.</div>
    <div class="kpd-sub" id="kpd-co-s">You're the one holding it all together.</div>
  </div></div>`;

  await ev(page, async (h) => {
    await window.__kp.showStage(h, 480);
    document.getElementById('kpd-boot')?.remove(); // navy stage now covers; safe to drop
  }, html);
  await ev(page, () => { document.getElementById('kpd-co-h').classList.add('kpd-reveal'); });
  await page.waitForTimeout(900);
  await ev(page, () => { document.getElementById('kpd-co-s').classList.add('kpd-reveal'); });
  await page.waitForTimeout(2600);
}

// =====================================================================
// SCENE 2 — Welcome / onboarding (modal sequence over the real shell)
// =====================================================================
export async function sceneOnboarding(page) {
  // Show app shell behind a scrim; the cursor turns on for this scene.
  await ev(page, async () => {
    await window.__kp.setCursor(window.innerWidth * 0.5, window.innerHeight * 0.78);
    await window.__kp.cursorOn();
  });

  // ---- 2a Welcome ----
  const welcome = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>Welcome</div>
      <h2>Welcome to Keepance</h2>
      <p class="kpd-lead">The private place your whole practice lives, and answers you back. Let&rsquo;s set up your first client in under a minute.</p>
      ${STEP_PIPS(0)}
      <button class="kpd-btn" id="kpd-primary">Get started</button>
    </div>`;
  await ev(page, async (h) => { await window.__kp.showStage(h, 360); }, welcome);
  await page.waitForTimeout(700);
  await clickModalPrimary(page, 1900);

  // ---- 2b Choose profession ----
  const prof = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>About you</div>
      <h2>What kind of work do you do?</h2>
      <p class="kpd-lead">Keepance tailors your Client Map to your field.</p>
      ${STEP_PIPS(1)}
      <div class="kpd-options" id="kpd-profs">
        ${optCard('Financial Advisor', 'Households, accounts, and plans', ICON.chart, true)}
        ${optCard('Attorney', 'Matters, parties, and filings', ICON.scale, false)}
        ${optCard('Accountant', 'Clients, entities, and filings', ICON.calc, false)}
        ${optCard('Consultant', 'Engagements and deliverables', ICON.briefcase, false)}
      </div>
      <button class="kpd-btn" id="kpd-primary">Continue</button>
    </div>`;
  await swapModal(page, prof);
  await page.waitForTimeout(500);
  // hover-confirm the selected card, then continue
  await ev(page, async () => {
    const card = document.querySelectorAll('#kpd-profs .kpd-opt')[0];
    const r = card.getBoundingClientRect();
    await window.__kp.moveTo(r.left + 40, r.top + r.height / 2, 760);
    await window.__kp.click();
  });
  await page.waitForTimeout(600);
  await clickModalPrimary(page, 900);

  // ---- 2c Create first client ----
  const create = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>Your first client</div>
      <h2>Create your first Client Map</h2>
      <p class="kpd-lead">A Client Map keeps one client&rsquo;s documents, emails, people, and open questions together.</p>
      ${STEP_PIPS(2)}
      <div class="kpd-field">
        <label>Client or household name</label>
        <div class="kpd-input" id="kpd-name"></div>
      </div>
      <button class="kpd-btn" id="kpd-primary">Create</button>
    </div>`;
  await swapModal(page, create);
  await page.waitForTimeout(400);
  // move cursor to the field, click, type
  await ev(page, async () => {
    const f = document.getElementById('kpd-name');
    const r = f.getBoundingClientRect();
    await window.__kp.moveTo(r.left + 24, r.top + r.height / 2, 720);
    await window.__kp.click();
  });
  await ev(page, async () => { await window.__kp.typeText('#kpd-name', 'Webb Household', 15); });
  await page.waitForTimeout(500);
  await clickModalPrimary(page, 900);

  // ---- 2d Privacy mode ----
  const privacy = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>Privacy</div>
      <h2>Where should this live?</h2>
      <p class="kpd-lead">You choose how private each client is. You can change this later.</p>
      ${STEP_PIPS(3)}
      <div class="kpd-options" id="kpd-priv">
        ${optCard('Local-first &middot; Private workspace', 'Your files and your keys stay on your computer. Nothing routes through a server we control.', ICON.lock, true)}
        ${optCard('Assured &middot; Zero-retention proxy', 'For firms that need a managed, audited path.', ICON.shield, false)}
      </div>
      <button class="kpd-btn" id="kpd-primary">Continue</button>
    </div>`;
  await swapModal(page, privacy);
  await page.waitForTimeout(900);
  await clickModalPrimary(page, 900, false); // last step: don't fade out yet; scene 3 swaps
}

// =====================================================================
// SCENE 3 — Connect an AI
// =====================================================================
export async function sceneConnectAI(page) {
  const connect = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>Connect an AI</div>
      <h2>Connect an AI</h2>
      <p class="kpd-lead">Bring your own key. It never leaves your machine.</p>
      <div class="kpd-providers" id="kpd-prov">
        <div class="kpd-chip sel"><span class="kpd-chip-dot"></span>Anthropic (Claude)</div>
        <div class="kpd-chip"><span class="kpd-chip-dot"></span>OpenAI</div>
        <div class="kpd-chip"><span class="kpd-chip-dot"></span>Google</div>
        <div class="kpd-chip"><span class="kpd-chip-dot"></span>Local (Ollama)</div>
      </div>
      <div class="kpd-field">
        <label>API key</label>
        <div class="kpd-input kpd-mono" id="kpd-key"></div>
      </div>
      <button class="kpd-btn" id="kpd-primary">Test &amp; connect</button>
      <div class="kpd-note">${ICON.lock}<span>Requests go straight from your computer to your provider. Keepance never sees your data.</span></div>
    </div>`;
  await swapModal(page, connect);
  await page.waitForTimeout(450);

  // click the key field and type the masked key
  await ev(page, async () => {
    const f = document.getElementById('kpd-key');
    const r = f.getBoundingClientRect();
    await window.__kp.moveTo(r.left + 24, r.top + r.height / 2, 720);
    await window.__kp.click();
  });
  await ev(page, async () => { await window.__kp.typeText('#kpd-key', 'sk-ant-api03-••••••••••••••••••••3f9', 26); });
  await page.waitForTimeout(450);

  // click Test & connect -> spinner -> success
  await ev(page, async () => {
    const btn = document.getElementById('kpd-primary');
    const r = btn.getBoundingClientRect();
    await window.__kp.moveTo(r.left + r.width / 2, r.top + r.height / 2, 700);
    await window.__kp.click();
    btn.classList.add('kpd-hot');
    btn.innerHTML = '<span class="kpd-spin"></span> Testing…';
  });
  await page.waitForTimeout(1500);
  // swap the key field area for a "connected" confirmation
  await ev(page, async () => {
    const k = document.getElementById('kpd-key');
    k.classList.remove('kpd-focus');
    const field = k.closest('.kpd-field');
    field.innerHTML = `<div class="kpd-connected kpd-in">
      <div class="kpd-tick"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div><div class="kpd-conn-title">AI connected securely</div><div class="kpd-conn-desc">Anthropic (Claude) &middot; key stored on this device only</div></div>
    </div>`;
    const btn = document.getElementById('kpd-primary');
    btn.classList.remove('kpd-hot');
    btn.innerHTML = 'Continue';
  });
  await page.waitForTimeout(1500);
  await clickModalPrimary(page, 700, false); // hand off to scene 4
}

// =====================================================================
// SCENE 4 — Connect your data (import with progress)  // DEMO-ONLY: scripted progress, not real indexing
// =====================================================================
export async function sceneConnectData(page) {
  const sources = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in" id="kpd-modal" style="width:600px">
      <div class="kpd-eyebrow"><span class="kpd-dot"></span>Connect your data</div>
      <h2>Bring in this client&rsquo;s context</h2>
      <p class="kpd-lead">Point Keepance at where the Webb household&rsquo;s information already lives.</p>
      <div class="kpd-options cols2" id="kpd-sources">
        ${optCard('Local documents', 'Plans, statements, forms', ICON.doc, true)}
        ${optCard('Email export', 'Client correspondence', ICON.mail, false)}
        ${optCard('Notes', 'Meeting &amp; review notes', ICON.note, false)}
        ${optCard('Client interview', 'Recorded intake', ICON.mic, false)}
        ${optCard('CRM export', 'Redtail / Wealthbox', ICON.database, false)}
      </div>
      <button class="kpd-btn" id="kpd-primary">Import &amp; build the Client Map</button>
    </div>`;
  await swapModal(page, sources);
  await page.waitForTimeout(900);
  await ev(page, async () => {
    const btn = document.getElementById('kpd-primary');
    const r = btn.getBoundingClientRect();
    await window.__kp.moveTo(r.left + r.width / 2, r.top + r.height / 2, 720);
    await window.__kp.click();
  });
  await page.waitForTimeout(250);

  // swap to the import progress panel
  const importer = `<div class="kpd-scrim"></div>
    <div class="kpd-modal kpd-in kpd-import" id="kpd-modal">
      <div class="kpd-import-head">
        <div class="kpd-import-ico">${ICON.spark}</div>
        <div><div class="kpd-import-title">Building the Client Map</div>
        <div class="kpd-import-sub">Webb Household &middot; reading what you already have</div></div>
      </div>
      <div class="kpd-tasks">
        ${task('Scanning documents', '47 files')}
        ${task('Reading emails', '126 messages')}
        ${task('Extracting people, dates, accounts &amp; open questions', '')}
        ${task('Finding source citations', '')}
        ${task('Assembling the Client Map', '')}
      </div>
      <div class="kpd-progress"><div class="kpd-bar"></div></div>
      <div class="kpd-progress-row">
        <span class="kpd-local"><span class="kpd-lock"></span>All processing happens locally on your machine</span>
        <span class="kpd-pct">0%</span>
      </div>
    </div>`;
  await ev(page, (h) => { document.getElementById('kpd-demo-stage').innerHTML = h; }, importer);
  await ev(page, async () => { await window.__kp.cursorOff(); });

  // drive the progress through 5 tasks
  const steps = [
    { task: 0, to: 16, hold: 620 },
    { task: 1, to: 40, hold: 720 },
    { task: 2, to: 64, hold: 820 },
    { task: 3, to: 82, hold: 640 },
    { task: 4, to: 100, hold: 700 },
  ];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await ev(page, (idx) => window.__kp.taskActive(idx), s.task);
    // ramp the bar smoothly to target
    await ev(page, (pct) => window.__kp.setBar(pct), s.to);
    await page.waitForTimeout(s.hold);
    await ev(page, (idx) => window.__kp.taskDone(idx), s.task);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(650);
  // hide overlay -> reveal the real app (scene 5 will navigate to Client Map)
  await ev(page, async () => { await window.__kp.hideStage(560); });
}

// =====================================================================
// SCENE 7 — Closing
// =====================================================================
export async function sceneClosing(page) {
  await ev(page, async () => { await window.__kp.cursorOff(); });
  const html = `<div class="kpd-scene"><div class="kpd-fullcard">
    <div class="kpd-grain"></div>
    <div class="kpd-close-logo" id="kpd-cl-logo">
      <div class="kpd-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
      <div class="kpd-word">Keepance</div>
    </div>
    <div class="kpd-headline" id="kpd-cl-h" style="font-size:34px">Know every client.<br>Cite every answer. Keep context secure.</div>
    <div class="kpd-sub" id="kpd-cl-s">Private client intelligence for high-trust work.</div>
  </div></div>`;
  await ev(page, async (h) => { await window.__kp.showStage(h, 620); }, html);
  await ev(page, () => { document.getElementById('kpd-cl-logo').classList.add('kpd-reveal'); });
  await page.waitForTimeout(500);
  await ev(page, () => { document.getElementById('kpd-cl-h').classList.add('kpd-reveal'); });
  await page.waitForTimeout(700);
  await ev(page, () => { document.getElementById('kpd-cl-s').classList.add('kpd-reveal'); });
  await page.waitForTimeout(2400);
}

// ---------- shared building blocks ----------
function optCard(title, desc, icon, selected) {
  return `<div class="kpd-opt${selected ? ' sel' : ''}">
    <div class="kpd-opt-ico">${icon}</div>
    <div class="kpd-opt-body"><div class="kpd-opt-title">${title}</div><div class="kpd-opt-desc">${desc}</div></div>
    <div class="kpd-opt-check">${selected ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</div>
  </div>`;
}
function task(label, count) {
  return `<div class="kpd-task">
    <div class="kpd-task-ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <span>${label}</span><span class="kpd-task-count">${count}</span>
  </div>`;
}

// move cursor to the modal's primary button, click it, and fade the modal out (or not)
async function clickModalPrimary(page, moveDur = 900, fadeOut = true) {
  await ev(page, async (dur) => {
    const btn = document.getElementById('kpd-primary');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    await window.__kp.moveTo(r.left + r.width / 2, r.top + r.height / 2, dur);
    btn.classList.add('kpd-hot');
    await window.__kp.click();
  }, moveDur);
  await page.waitForTimeout(220);
  if (fadeOut) {
    await ev(page, async () => {
      const m = document.getElementById('kpd-modal');
      if (m) { m.classList.remove('kpd-in'); m.classList.add('kpd-out'); }
      await window.__kp.sleep(240);
    });
  }
}

// swap the modal content (fade old out, new in) without hiding the scrim/stage
async function swapModal(page, html) {
  await ev(page, async (h) => {
    const m = document.getElementById('kpd-modal');
    if (m) { m.classList.remove('kpd-in'); m.classList.add('kpd-out'); await window.__kp.sleep(220); }
    document.getElementById('kpd-demo-stage').innerHTML = h;
  }, html);
}
