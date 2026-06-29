/*
 * marketing-demo/render/stage.js
 * DEMO-ONLY in-browser engine for the marketing demo video. Injected into the
 * page by the Playwright director. Provides an animated cursor, a full-screen
 * "stage" for the scripted scenes, typing/caption helpers, and progress
 * animation. Nothing here ships in the product.
 *
 * Everything that animates returns a Promise that resolves when the animation
 * finishes, so the Node director can `await page.evaluate(() => __kp.xxx())`
 * and keep deterministic timing.
 */
(function () {
  if (window.__kp && window.__kp.__ready) return;

  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(r));

  const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 3 L5 21 L10 16.2 L13.2 22.5 L16 21.2 L12.9 15 L20 15 Z"
      fill="#0a2540" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;

  let cursorEl, rippleEl, stageEl, captionEl;
  const cur = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.62 };

  function build() {
    const style = document.getElementById('kpd-demo-style');
    if (!style) console.warn('[kp] brand.css not injected yet');

    stageEl = document.createElement('div');
    stageEl.id = 'kpd-demo-stage';
    document.body.appendChild(stageEl);

    rippleEl = document.createElement('div');
    rippleEl.id = 'kpd-click-ripple';
    document.body.appendChild(rippleEl);

    cursorEl = document.createElement('div');
    cursorEl.id = 'kpd-cursor';
    cursorEl.innerHTML = CURSOR_SVG;
    document.body.appendChild(cursorEl);

    captionEl = document.createElement('div');
    captionEl.id = 'kpd-caption';
    document.body.appendChild(captionEl);

    applyCursor();
  }

  function applyCursor() {
    cursorEl.style.transform = `translate(${cur.x - 2}px, ${cur.y - 2}px)`;
  }

  const api = {
    __ready: true,

    cursorOn() { cursorEl.classList.add('kpd-on'); return Promise.resolve(); },
    cursorOff() { cursorEl.classList.remove('kpd-on'); return Promise.resolve(); },
    setCursor(x, y) { cur.x = x; cur.y = y; applyCursor(); return Promise.resolve(); },
    getCursor() { return { x: cur.x, y: cur.y }; },

    async moveTo(x, y, dur = 720, curve = 'inOut') {
      const sx = cur.x, sy = cur.y;
      const dx = x - sx, dy = y - sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) { cur.x = x; cur.y = y; applyCursor(); return; }
      const fn = ease[curve] || ease.inOut;
      const start = performance.now();
      // subtle arc: bow the path slightly perpendicular for a human feel
      const nx = -dy / dist, ny = dx / dist;
      const bow = Math.min(46, dist * 0.10);
      while (true) {
        const now = performance.now();
        let t = (now - start) / dur;
        if (t >= 1) t = 1;
        const e = fn(t);
        const arc = Math.sin(Math.PI * t) * bow;
        cur.x = sx + dx * e + nx * arc;
        cur.y = sy + dy * e + ny * arc;
        applyCursor();
        if (t >= 1) break;
        await raf();
      }
      cur.x = x; cur.y = y; applyCursor();
    },

    async moveToEl(selector, dur = 720, offset = { x: 0, y: 0 }) {
      const el = document.querySelector(selector);
      if (!el) { console.warn('[kp] moveToEl: not found', selector); return false; }
      const r = el.getBoundingClientRect();
      await api.moveTo(r.left + r.width / 2 + (offset.x || 0), r.top + r.height / 2 + (offset.y || 0), dur);
      return true;
    },

    async click(x, y) {
      const px = x ?? cur.x, py = y ?? cur.y;
      if (x != null) await api.moveTo(x, y, 460);
      cursorEl.classList.add('kpd-press');
      rippleEl.style.left = px + 'px';
      rippleEl.style.top = py + 'px';
      rippleEl.classList.remove('kpd-go');
      void rippleEl.offsetWidth;
      rippleEl.classList.add('kpd-go');
      await sleep(130);
      cursorEl.classList.remove('kpd-press');
      await sleep(120);
    },

    async clickEl(selector, dur = 720) {
      const ok = await api.moveToEl(selector, dur);
      if (!ok) return false;
      await api.click();
      return true;
    },

    // ---------- stage ----------
    setStageHTML(html) { stageEl.innerHTML = html; return Promise.resolve(); },
    async showStage(html, fade = 520) {
      if (html != null) stageEl.innerHTML = html;
      void stageEl.offsetWidth;
      stageEl.classList.add('kpd-show');
      await sleep(fade);
    },
    async hideStage(fade = 520) {
      stageEl.classList.remove('kpd-show');
      await sleep(fade);
      stageEl.innerHTML = '';
    },
    stageEl() { return stageEl; },

    // ---------- captions ----------
    async showCaption(text, fade = 360) {
      captionEl.innerHTML = text;
      void captionEl.offsetWidth;
      captionEl.classList.add('kpd-on');
      await sleep(fade);
    },
    async hideCaption(fade = 360) {
      captionEl.classList.remove('kpd-on');
      await sleep(fade);
    },

    // ---------- helpers used inside scenes ----------
    addClass(sel, cls) { const e = stageEl.querySelector(sel); if (e) e.classList.add(cls); return Promise.resolve(); },
    removeClass(sel, cls) { const e = stageEl.querySelector(sel); if (e) e.classList.remove(cls); return Promise.resolve(); },

    // animate text into an element (with a blinking caret), char-by-char
    async typeText(sel, text, cps = 22, caret = true) {
      const e = stageEl.querySelector(sel);
      if (!e) return;
      e.classList.add('kpd-focus');
      const caretHTML = caret ? '<span class="kpd-caret"></span>' : '';
      const delay = 1000 / cps;
      let shown = '';
      for (let i = 0; i < text.length; i++) {
        shown += text[i];
        e.innerHTML = escapeHtml(shown) + caretHTML;
        // jitter the per-char delay a touch for a natural feel
        await sleep(delay * (0.7 + Math.random() * 0.7));
      }
    },

    // progress bar + task list driver for the import scene
    setBar(pct) {
      const bar = stageEl.querySelector('.kpd-bar');
      const lbl = stageEl.querySelector('.kpd-pct');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = Math.round(pct) + '%';
      return Promise.resolve();
    },
    taskActive(i) {
      const t = stageEl.querySelectorAll('.kpd-task')[i];
      if (t) t.classList.add('active');
      return Promise.resolve();
    },
    taskDone(i) {
      const t = stageEl.querySelectorAll('.kpd-task')[i];
      if (t) { t.classList.remove('active'); t.classList.add('done'); }
      return Promise.resolve();
    },

    sleep,
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  build();
  window.__kp = api;
})();
