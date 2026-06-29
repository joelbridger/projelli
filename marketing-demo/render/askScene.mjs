/*
 * marketing-demo/render/askScene.mjs
 * DEMO-ONLY Scene 6 (Ask). A faithful replica of the real Keepance "Ask" UI,
 * overlaid on the content region (right of the REAL sidebar + below the REAL
 * top bar). The real Ask pipeline can't produce a live-typed, Webb-specific,
 * verified-citation answer in-browser, so this scene is a scripted replica that
 * matches the real components (TurnBlock / CitationText / SourcePanel /
 * "Answered over your own files" attestation). Clearly demo-only.
 */

const ev = (page, fn, ...args) => page.evaluate(fn, ...args);

// ---- SVG icons (trusted, inline) ----
const I = {
  spark: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.7 4.9L18 9.5l-4.3 1.6L12 16l-1.7-4.9L6 9.5l4.3-1.6L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6.5" cy="17.5" r="1.4" stroke="currentColor" stroke-width="1.3"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  quote: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 7h4v4c0 2-1.5 3.5-3.5 4M13 7h4v4c0 2-1.5 3.5-3.5 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8.5 12.2l2.3 2.3 4.6-4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  shield: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  doc: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7"/></svg>`,
  mail: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.7"/></svg>`,
  send: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const chip = (n) => `<span class="kpd-cite" data-cite="${n}"><span style="display:inline-flex">${I.check}</span>${n}</span>`;

// answer 1 (meeting prep) — bold lead-ins + inline {n} chips
const ANSWER1 = `<b>Where things stand.</b> The Webbs want to retire at 60 and put both kids through college; the plan is moderate-growth, rebalanced once a year. ${chip(1)}<br><br>` +
  `<b>What changed since last meeting.</b> Tanya got a raise, so they can add $400/month to savings, and the old employer 401(k) (about $96k) still hasn't been rolled over. ${chip(2)}<br><br>` +
  `<b>Watch this.</b> <span class="kpd-warnote">The old 401(k) still names Marcus's ex-wife, Jessica Reyes, as the sole beneficiary, dated 2019.</span> If it isn't fixed before the rollover, that account would pass to her, not Tanya. ${chip(3)}<br><br>` +
  `<b>Talking points.</b> Start the rollover (it also fixes the beneficiary gap), confirm the Roth conversion amount before December, and raise the brokerage auto-contribution. ${chip(1)}`;

const SOURCES1 = [
  { n: 1, file: 'Financial Plan Summary.md', quote: 'Goals: retire at 60, fund both kids’ college… Hold the moderate-growth allocation; rebalance once a year.' },
  { n: 2, file: 'Review Notes.md', quote: 'Tanya got a raise. They can push another $400/month into savings… the $96k old 401(k) is still at the prior custodian.' },
  { n: 3, file: 'Beneficiary Designations.md', quote: 'The old 401(k) still lists Jessica Reyes, Marcus’s first wife, as the sole primary beneficiary, dated 2019.' },
];

const ANSWER2 = `Here’s a short draft you can send. ${chip(1)}`;
const EMAIL = {
  subject: 'Quick item before we finalize your rollover',
  body: `Hi Marcus,<br><br>Before we move your old 401(k) into your IRA, I want to confirm one detail on the current account. Our records show the beneficiary there still lists a name from before your 2019 update. Could you confirm the latest beneficiary form for that account?<br><br>Once that’s set, the rollover puts everything under the right designations.<br><br>Thanks,<br>[Your name]`,
};

export async function runAskScene(page) {
  // Build + reveal the Ask replica FIRST, over the real Client Map, so the real
  // (old) Ask surface never flashes. The replica is positioned from the sidebar
  // geometry, which is the same on the Client Map and Ask surfaces.
  await ev(page, (data) => {
    const sb = document.querySelector('[data-testid="sidebar"]');
    const r = sb ? sb.getBoundingClientRect() : { right: 232, top: 96 };
    const left = Math.round(r.right);
    const top = Math.round(r.top);
    const { ICONS } = data;

    const srcCards = data.SOURCES1.map((s) => `
      <div class="kpd-srccard" data-srccard="${s.n}">
        <div class="kpd-src-file"><span class="kpd-src-n">${s.n}</span>${ICONS.doc}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.file}</span></div>
        <div class="kpd-src-quote">${s.quote}</div>
        <div class="kpd-src-verify">${ICONS.shield} Verified against source</div>
      </div>`).join('');

    const html = `
      <div class="kpd-ask-head">
        <div class="kpd-ask-title"><span class="kpd-ask-spark">${ICONS.spark}</span>Ask</div>
        <div class="kpd-ask-sub">Ask anything across your work. Every answer cites its source.</div>
      </div>
      <div class="kpd-ask-body">
        <div class="kpd-rail">
          <div class="kpd-rail-h">Conversations</div>
          <div class="kpd-newq">${ICONS.plus} New question</div>
          <div class="kpd-convo" id="kpd-convo"><div>Webb Household · meeting prep</div><div class="kpd-convo-sub">just now</div></div>
        </div>
        <div class="kpd-main">
          <div class="kpd-thread">
            <div class="kpd-turns" id="kpd-turns" style="flex:1;display:flex;flex-direction:column;gap:22px;overflow:hidden"></div>
            <div style="display:flex;flex-direction:column;gap:12px;padding-top:8px">
              <div class="kpd-scope">
                <div class="kpd-pill sel">This client</div>
                <div class="kpd-pill">All clients</div>
                <div class="kpd-pill">Email</div>
                <div class="kpd-pill">Documents</div>
              </div>
              <div class="kpd-composer">
                <div class="kpd-ci" id="kpd-ci"><span style="color:var(--d-accent);display:inline-flex">${ICONS.spark2}</span><span class="kpd-ph" id="kpd-ci-text">Ask Webb Household…</span></div>
                <div class="kpd-ask-btn dim" id="kpd-askbtn">${ICONS.send} Ask</div>
              </div>
            </div>
          </div>
          <div class="kpd-srcpanel">
            <div class="kpd-src-h">${ICONS.shield} Sources</div>
            <div id="kpd-srclist">${srcCards}</div>
          </div>
        </div>
      </div>`;

    const ask = document.createElement('div');
    ask.id = 'kpd-ask';
    ask.style.left = left + 'px';
    ask.style.top = top + 'px';
    ask.style.width = (window.innerWidth - left) + 'px';
    ask.style.height = (window.innerHeight - top) + 'px';
    ask.innerHTML = html;
    document.getElementById('kpd-demo-stage').appendChild(ask);
    // show the stage as a transparent host (so #kpd-ask is visible but no scrim)
    const stage = document.getElementById('kpd-demo-stage');
    stage.style.background = 'transparent';
    stage.classList.add('kpd-show');
    requestAnimationFrame(() => ask.classList.add('kpd-in'));
  }, { SOURCES1, ICONS: { ...I, spark2: I.spark } });
  await page.waitForTimeout(480); // let the replica finish fading in (now opaque)

  // Only NOW switch the real sidebar's active item to "Ask" — it renders hidden
  // beneath the opaque replica, so the old Ask surface never flashes.
  await page.click('[data-testid="spine-nav-search"]').catch(() => {});

  await ev(page, async () => { await window.__kp.cursorOn(); });
  await page.waitForTimeout(700);

  // ---- Q1: type the meeting-prep question into the replica composer ----
  await typeComposer(page, 'What should I know before my next meeting with the Webb household?');
  await page.waitForTimeout(350);
  await clickAsk(page);

  // answering spinner
  await ev(page, () => {
    const turns = document.getElementById('kpd-turns');
    const a = document.createElement('div');
    a.className = 'kpd-answering';
    a.id = 'kpd-answering';
    a.innerHTML = '<span class="kpd-spin2"></span><span>Searching the Webb household’s files…</span>';
    turns.appendChild(a);
    document.getElementById('kpd-convo').classList.add('kpd-in');
  });
  await page.waitForTimeout(1500);

  // reveal the answer turn
  await ev(page, (data) => {
    document.getElementById('kpd-answering')?.remove();
    const turns = document.getElementById('kpd-turns');
    const t = document.createElement('div');
    t.className = 'kpd-turn';
    t.innerHTML = `
      <div class="kpd-q">${data.ICONS.quote}<span>What should I know before my next meeting with the Webb household?</span></div>
      <div class="kpd-a">
        <p class="kpd-ans">${data.ANSWER1}</p>
        <div class="kpd-attest" id="kpd-attest1">${data.ICONS.shield} Answered over your own files. Every cited claim can be checked against the source.</div>
      </div>`;
    turns.appendChild(t);
    requestAnimationFrame(() => t.classList.add('kpd-in'));
  }, { ANSWER1, ICONS: I });
  await page.waitForTimeout(650);

  // pop the citation chips one by one
  await ev(page, async () => {
    const chips = [...document.querySelectorAll('#kpd-turns .kpd-cite')];
    for (const c of chips) { c.classList.add('kpd-pop'); await window.__kp.sleep(170); }
  });
  await page.waitForTimeout(250);
  // reveal source cards (right panel) + attestation
  await ev(page, async () => {
    const cards = [...document.querySelectorAll('#kpd-srclist .kpd-srccard')];
    for (const c of cards) { c.classList.add('kpd-in'); await window.__kp.sleep(170); }
    document.getElementById('kpd-attest1')?.classList.add('kpd-in');
  });
  await page.waitForTimeout(2050);

  // ---- Q2: draft the follow-up email ----
  await typeComposer(page, 'Draft a follow-up email asking for the missing beneficiary information.');
  await page.waitForTimeout(300);
  await clickAsk(page);
  await ev(page, () => {
    const turns = document.getElementById('kpd-turns');
    const a = document.createElement('div');
    a.className = 'kpd-answering'; a.id = 'kpd-answering';
    a.innerHTML = '<span class="kpd-spin2"></span><span>Drafting from the beneficiary record…</span>';
    turns.appendChild(a);
  });
  await page.waitForTimeout(1300);
  await ev(page, (data) => {
    document.getElementById('kpd-answering')?.remove();
    const turns = document.getElementById('kpd-turns');
    const t = document.createElement('div');
    t.className = 'kpd-turn';
    t.innerHTML = `
      <div class="kpd-q">${data.ICONS.quote}<span>Draft a follow-up email asking for the missing beneficiary information.</span></div>
      <div class="kpd-a">
        <p class="kpd-ans">${data.ANSWER2}</p>
        <div class="kpd-email">
          <div class="kpd-email-bar">${data.ICONS.mail} To: Marcus Webb</div>
          <div class="kpd-email-body"><div class="kpd-subj">${data.EMAIL.subject}</div>${data.EMAIL.body}</div>
        </div>
        <div class="kpd-attest" id="kpd-attest2">${data.ICONS.shield} Drafted from your records. Grounded in the beneficiary file.</div>
      </div>`;
    turns.appendChild(t);
    requestAnimationFrame(() => t.classList.add('kpd-in'));
    // scroll the thread so the email is fully visible
    const th = document.querySelector('#kpd-ask .kpd-turns');
    if (th) th.scrollTop = th.scrollHeight;
  }, { ANSWER2, EMAIL, ICONS: I });
  await page.waitForTimeout(500);
  await ev(page, async () => {
    const c = document.querySelector('#kpd-turns .kpd-turn:last-child .kpd-cite');
    if (c) c.classList.add('kpd-pop');
    await window.__kp.sleep(250);
    document.getElementById('kpd-attest2')?.classList.add('kpd-in');
  });
  await page.waitForTimeout(1950);

  // tidy up: fade the ask replica away (closing scene takes over)
  await ev(page, async () => {
    const ask = document.getElementById('kpd-ask');
    if (ask) ask.classList.remove('kpd-in');
    await window.__kp.sleep(420);
    if (ask) ask.remove();
  });
}

// type into the replica composer with a caret + enable the Ask button
async function typeComposer(page, text) {
  await ev(page, async () => {
    const ci = document.getElementById('kpd-ci');
    const r = ci.getBoundingClientRect();
    await window.__kp.moveTo(r.left + 30, r.top + r.height / 2, 760);
    await window.__kp.click();
    ci.classList.add('kpd-focus');
    document.getElementById('kpd-ci-text').innerHTML = '<span class="kpd-caret"></span>';
  });
  await ev(page, async (t) => {
    const el = document.getElementById('kpd-ci-text');
    let shown = '';
    for (let i = 0; i < t.length; i++) {
      shown += t[i];
      el.innerHTML = shown.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '<span class="kpd-caret"></span>';
      await window.__kp.sleep(34 * (0.6 + Math.random() * 0.8));
    }
    document.getElementById('kpd-askbtn').classList.remove('dim');
  }, text);
}

async function clickAsk(page) {
  await ev(page, async () => {
    const btn = document.getElementById('kpd-askbtn');
    const r = btn.getBoundingClientRect();
    await window.__kp.moveTo(r.left + r.width / 2, r.top + r.height / 2, 620);
    await window.__kp.click();
    // reset composer to placeholder
    const ci = document.getElementById('kpd-ci');
    ci.classList.remove('kpd-focus');
    document.getElementById('kpd-ci-text').innerHTML = '<span class="kpd-ph">Ask Webb Household…</span>';
    btn.classList.add('dim');
  });
}
