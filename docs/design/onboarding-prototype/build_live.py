#!/usr/bin/env python3
# Generates the Keepance onboarding as LIVE per-scene HTML (crisp, no video) + an interactive shell.
# AUDIENCE: financial advisors (re-aim 2026-06-24). Unit = client / household.
# Self-contained: reads brand assets from ./assets and writes a servable site to ./dist
# (override the output dir with the ONBOARD_OUT env var).
import os, shutil
BASE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(BASE, "assets")
OUT = os.environ.get("ONBOARD_OUT", os.path.join(BASE, "dist"))

CSS = """
@font-face{font-family:'Sora';font-weight:400;font-display:block;src:url('fonts/sora-400.woff2') format('woff2');}
@font-face{font-family:'Sora';font-weight:500;font-display:block;src:url('fonts/sora-500.woff2') format('woff2');}
@font-face{font-family:'Sora';font-weight:600;font-display:block;src:url('fonts/sora-600.woff2') format('woff2');}
@font-face{font-family:'Sora';font-weight:700;font-display:block;src:url('fonts/sora-700.woff2') format('woff2');}
@font-face{font-family:'Sora';font-weight:800;font-display:block;src:url('fonts/sora-800.woff2') format('woff2');}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:transparent;font-family:'Sora',system-ui,sans-serif;color:#0a2540}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;overflow:hidden;background:transparent}
.scene-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:110px 320px 200px}
.logo-big{height:100px;margin-bottom:8px}
.eyebrow{font-size:21px;font-weight:700;letter-spacing:7px;color:#5b6b80;margin-bottom:34px}
.underline{height:8px;width:260px;border-radius:99px;margin:34px 0 38px;background:linear-gradient(90deg,#ff3ce8,#5dc6ff);transform-origin:center}
.headline{font-size:58px;font-weight:800;line-height:1.14;letter-spacing:-1.5px;max-width:1120px}
.sub{font-size:26px;font-weight:500;color:rgba(10,37,64,.72);max-width:980px;line-height:1.6;margin-top:34px}
.row{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;margin-top:52px;max-width:1300px}
.pill{font-size:20px;font-weight:600;background:rgba(255,255,255,.92);border:1px solid rgba(10,37,64,.08);box-shadow:0 8px 30px rgba(10,37,64,.06);padding:13px 24px;border-radius:99px;display:flex;align-items:center;gap:10px}
.dot{width:10px;height:10px;border-radius:99px;flex-shrink:0}
.asks{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:48px}
.ask{font-size:22px;font-weight:500;color:#0a2540;background:#fff;border:1px solid rgba(10,37,64,.07);box-shadow:0 10px 30px rgba(10,37,64,.07);padding:16px 26px;border-radius:18px;border-bottom-left-radius:5px}
.cards{display:flex;gap:26px;margin-top:50px;justify-content:center;flex-wrap:wrap;max-width:1280px}
.card{background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 14px 44px rgba(10,37,64,.08);border-radius:22px;padding:32px;width:460px;text-align:left}
.card .ct{font-size:25px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:12px}
.card .cb{font-size:19px;font-weight:400;color:rgba(10,37,64,.66);line-height:1.55}
.num{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:99px;background:linear-gradient(90deg,#ff3ce8,#5dc6ff);color:#fff;font-size:17px;font-weight:800;flex-shrink:0}
.badge{font-size:13px;font-weight:700;color:#fff;background:linear-gradient(90deg,#ff3ce8,#5dc6ff);padding:6px 13px;border-radius:99px;letter-spacing:.5px;display:inline-block;margin-bottom:14px}
.opt{background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 14px 40px rgba(10,37,64,.07);border-radius:18px;padding:26px;width:340px;font-size:23px;font-weight:700;text-align:center}
.providers{display:flex;gap:14px;justify-content:center;margin-top:30px}
.prov{font-size:18px;font-weight:600;background:#fff;border:1px solid rgba(10,37,64,.1);border-radius:13px;padding:12px 26px}
.cta{font-size:25px;font-weight:700;color:#fff;background:#0a2540;padding:17px 42px;border-radius:99px;box-shadow:0 14px 36px rgba(10,37,64,.22);border:none;cursor:pointer;font-family:inherit}
.stack{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-top:44px;max-width:1180px}
.tool{background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 8px 26px rgba(10,37,64,.06);padding:14px;border-radius:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:226px;height:90px}
.toollogo{height:30px;max-width:172px;width:auto;object-fit:contain;display:block}
.tool .cat{font-size:11px;font-weight:700;letter-spacing:1.2px;color:#8a93a3}
.layer{margin-top:40px;display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(255,60,232,.08),rgba(93,198,255,.12));border:1px solid rgba(10,37,64,.1);border-radius:18px;padding:17px 30px;font-size:20px;font-weight:600;color:#0a2540;box-shadow:0 14px 40px rgba(10,37,64,.06);max-width:980px}
.layer-logo{height:28px;flex-shrink:0}
/* anti-flash: hide animating elements before first paint; GSAP reveals them (or the JS failsafe at 4s does). The bg + corner logo now live in the shell, so they never reload between scenes. */
.logo-big,.eyebrow,.headline,.sub,.item{opacity:0}
.underline{transform:scaleX(0)}
"""

scenes = [
 ("welcome", "Get started", """
  <img class="logo-big" src="keepance-logo.svg" alt="Keepance" />
  <div class="underline"></div>
  <div class="sub">A private AI that actually knows your clients. Everything stays on your computer, never in someone else's cloud.</div>
  <div class="row"><div class="pill item"><span class="dot" style="background:#5dc6ff"></span>Knows your whole client</div><div class="pill item"><span class="dot" style="background:#ff3ce8"></span>Answers you can verify</div><div class="pill item"><span class="dot" style="background:#0a2540"></span>Stays on your computer</div></div>
  <button type="button" class="cta item" style="margin-top:52px" onclick="parent.postMessage('kp-advance','*')">Get started</button>
 """),
 ("clients", "Continue", """
  <div class="eyebrow">KNOWS YOUR CLIENTS</div>
  <div class="headline">Open a client. It already knows<br/>the whole household.</div>
  <div class="sub">Keepance reads your files, emails, and notes right on your computer, so you walk into every meeting already prepared.</div>
  <div class="asks"><div class="ask item">What changed for the Hendricks household since our last review?</div><div class="ask item">Draft the follow-up email from today's meeting notes.</div><div class="ask item">Find the email about the 529 rollover.</div></div>
 """),
 ("advisors", "Continue", """
  <div class="eyebrow">BUILT FOR ADVISORS</div>
  <div class="headline">For advisors who guard<br/>their clients' privacy</div>
  <div class="sub">If your clients trust you with their financial lives, Keepance was built for you.</div>
  <div class="row"><div class="pill item">Independent RIAs</div><div class="pill item">Fee-only planners</div><div class="pill item">Wealth managers</div><div class="pill item">Solo or a small firm</div></div>
 """),
 ("ecosystem", "Continue", """
  <div class="eyebrow">FITS RIGHT INTO YOUR STACK</div>
  <div class="headline">Works with the tools<br/>you already use</div>
  <div class="sub">A client's story is scattered across a dozen tools. Keepance reads across the ones you use and answers with citations. It does not replace them.</div>
  <div class="stack">
   <div class="tool item"><img class="toollogo" src="logos/wealthbox.svg" alt="Wealthbox"><span class="cat">CRM</span></div>
   <div class="tool item"><img class="toollogo" src="logos/rightcapital.svg" alt="RightCapital"><span class="cat">PLANNING</span></div>
   <div class="tool item"><img class="toollogo" src="logos/holistiplan.png" alt="Holistiplan"><span class="cat">TAX</span></div>
   <div class="tool item"><img class="toollogo" src="logos/tamarac.svg" alt="Envestnet Tamarac"><span class="cat">PORTFOLIO</span></div>
   <div class="tool item"><img class="toollogo" src="logos/schwab.svg" alt="Charles Schwab"><span class="cat">CUSTODIAN</span></div>
   <div class="tool item"><img class="toollogo" src="logos/outlook.svg" alt="Outlook"><span class="cat">EMAIL</span></div>
   <div class="tool item"><img class="toollogo" src="logos/onedrive.svg" alt="OneDrive"><span class="cat">FILES</span></div>
   <div class="tool item"><img class="toollogo" src="logos/jump.svg" alt="Jump"><span class="cat">MEETING NOTES</span></div>
  </div>
  <div class="layer item"><img class="layer-logo" src="keepance-logo.svg" alt="Keepance"/><span>reads across all of it, privately, and answers with citations</span></div>
 """),
 ("teach1", "Continue", """
  <div class="eyebrow">USING AI, SAFELY</div>
  <div class="headline">AI is new. It does not<br/>have to be scary.</div>
  <div class="sub">AI is just a smart assistant that can read and write. The only question that matters for client data is where it goes. Keepance makes sure the answer is always somewhere you control.</div>
 """),
 ("teach2", "Continue", """
  <div class="eyebrow">TWO SAFE WAYS</div>
  <div class="headline">Two safe ways to power Keepance</div>
  <div class="sub">Whichever you choose, your clients' information stays protected.</div>
  <div class="cards"><div class="card item"><div class="ct"><span class="num">1</span>Connect a secure AI provider</div><div class="cb">Use your own account with a trusted AI company.</div></div><div class="card item"><div class="ct"><span class="num">2</span>Keep the AI on your computer</div><div class="cb">Run a private AI model on your own machine.</div></div></div>
 """),
 ("teach3", "Continue", """
  <div class="eyebrow">WAY 1, EXPLAINED</div>
  <div class="headline">Connect a secure AI provider</div>
  <div class="sub">Connect your own account with a trusted AI company. Your questions go straight to them with your key, and never pass through Keepance.</div>
  <div class="row"><div class="pill item">OpenAI</div><div class="pill item">Anthropic (Claude)</div><div class="pill item">Google (Gemini)</div></div>
  <div class="row"><div class="pill item"><span class="dot" style="background:#5dc6ff"></span>SOC 2 certified, independently audited for security</div></div>
 """),
 ("teach4", "Continue", """
  <div class="eyebrow">WAY 2, EXPLAINED</div>
  <div class="headline">Keep the AI on your computer</div>
  <div class="sub">Run a free AI model entirely on your machine. Your client data never leaves, not even to an AI company. It is the most private option there is.</div>
  <div class="row"><div class="pill item"><span class="dot" style="background:#0a2540"></span>One-time download, a few GB</div><div class="pill item"><span class="dot" style="background:#0a2540"></span>A bit less powerful than top cloud models</div></div>
 """),
 ("choose", "Continue", """
  <div class="eyebrow">YOUR CHOICE</div>
  <div class="headline">Pick what fits you.<br/>There is no wrong answer.</div>
  <div class="sub">You can change this any time, or ask Keepance to explain it again.</div>
  <div class="cards"><div class="opt item"><div class="badge">RECOMMENDED</div><div>Connect my AI account</div></div><div class="opt item">Keep AI on my computer</div><div class="opt item">Decide later</div></div>
 """),
 ("email", "Continue", """
  <div class="eyebrow">YOUR CLIENT EMAILS, TOO</div>
  <div class="headline">Never miss a client detail</div>
  <div class="sub">Keepance can securely bring in your email, so every client conversation is searchable and ready as context for your AI.</div>
  <div class="row"><div class="pill item"><span class="dot" style="background:#5dc6ff"></span>Instant, accurate search</div><div class="pill item"><span class="dot" style="background:#ff3ce8"></span>Context from real conversations</div></div>
  <div class="providers"><div class="prov item">Microsoft</div><div class="prov item">Google</div><div class="prov item">Other</div></div>
 """),
 ("team", "Continue", """
  <div class="eyebrow">SOLO OR A FIRM</div>
  <div class="headline">Work as a team, privately</div>
  <div class="sub">Share a household with your team through an encrypted vault that only your firm can open.</div>
  <div class="cards"><div class="opt item">Create a firm</div><div class="opt item">Join a firm</div><div class="opt item">I work solo</div></div>
 """),
 ("done", "Start over ↺", """
  <div class="eyebrow">YOU ARE SET</div>
  <div class="headline">You're set.</div>
  <div class="sub">Your clients' data stays on your computer. Every answer shows its sources. You are in control.</div>
  <div class="row"><div class="cta item">Open my first client</div></div>
 """),
]

def timeline_lines(html, is_welcome):
    # fromTo (explicit visible end-state) because the elements start hidden in CSS (anti-flash).
    L = []
    if 'logo-big' in html:
        L.append("tlIn.fromTo('.logo-big',{autoAlpha:0,scale:0.92},{autoAlpha:1,scale:1,duration:0.9,ease:'power3.out'},0.2);")
    if 'eyebrow' in html:
        L.append("tlIn.fromTo('.eyebrow',{autoAlpha:0,y:18},{autoAlpha:1,y:0,duration:0.6,ease:'power2.out'},0.3);")
    if 'class="headline"' in html:
        L.append("tlIn.fromTo('.headline',{autoAlpha:0,y:30},{autoAlpha:1,y:0,duration:0.75,ease:'power3.out'},0.4);")
    if 'underline' in html:
        L.append("tlIn.fromTo('.underline',{scaleX:0},{scaleX:1,duration:0.6,ease:'expo.out'},0.95);")
    if 'class="sub"' in html:
        L.append("tlIn.fromTo('.sub',{autoAlpha:0,y:22},{autoAlpha:1,y:0,duration:0.65,ease:'power2.out'},0.6);")
    if 'item' in html:
        L.append("tlIn.fromTo('.item',{autoAlpha:0,y:26,scale:0.96},{autoAlpha:1,y:0,scale:1,duration:0.55,stagger:0.1,ease:'back.out(1.5)'},0.95);")
    return "\n".join(L)

SCENE_TMPL = """<!doctype html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>__CSS__</style></head>
<body>
<div id="stage">
  <div class="scene-content">__HTML__</div>
</div>
<script>
  const stage=document.getElementById('stage');
  function fit(){const s=Math.min(window.innerWidth/1920,window.innerHeight/1080);stage.style.transform=`translate(-50%,-50%) scale(${s})`;}
  window.addEventListener('resize',fit);fit();
  function run(){
    const tlIn=gsap.timeline();
    __TL__
    setTimeout(function(){try{tlIn.progress(1);}catch(e){}},3500);
  }
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run);}else{window.addEventListener('load',run);}
  // Failsafe: if GSAP never runs (load failure), still reveal content (CSS hid it for anti-flash).
  setTimeout(function(){try{document.querySelectorAll('.logo-big,.eyebrow,.headline,.sub,.item').forEach(function(el){el.style.opacity='1';el.style.visibility='visible';el.style.transform='none';});var u=document.querySelector('.underline');if(u)u.style.transform='scaleX(1)';}catch(e){}},4000);
</script>
</body></html>"""

os.makedirs(OUT, exist_ok=True)
# copy brand assets in so dist/ is a complete, self-contained, servable site
for item in ("fonts","logos","keepance-logo.svg"):
    src = os.path.join(ASSETS,item); dst = os.path.join(OUT,item)
    if os.path.isdir(src): shutil.copytree(src,dst,dirs_exist_ok=True)
    elif os.path.isfile(src): shutil.copy2(src,dst)
for idx,(sid,cont,html) in enumerate(scenes):
    is_welcome = (sid=="welcome")
    doc = (SCENE_TMPL.replace("__CSS__",CSS)
           .replace("__HTML__",html).replace("__TL__",timeline_lines(html,is_welcome)))
    open(os.path.join(OUT,f"scene-{idx+1}.html"),"w").write(doc)

import json, time
ver = int(time.time())  # cache-bust: forces browsers to re-fetch scene files on every rebuild
scene_js = json.dumps([{"file":f"scene-{i+1}.html?v={ver}","cont":c} for i,(s,c,h) in enumerate(scenes)])
SHELL = """<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Keepance onboarding — interactive</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#e9ebf2;font-family:'Sora',system-ui,sans-serif;overflow:hidden;display:flex;align-items:center;justify-content:center}
/* the 16:9 presentation box, contained + centered in the window */
#stagebox{position:relative;width:min(100vw,177.78vh);aspect-ratio:16/9;overflow:hidden;background:#f5f6fb;box-shadow:0 14px 60px rgba(10,37,64,.16)}
#frame{position:absolute;inset:0;width:100%;height:100%;border:none;background:transparent;z-index:1}
/* persistent background — lives in the shell (scaled 1920x1080 layer) so it NEVER reloads/flashes when a scene advances */
#bglayer{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;overflow:hidden;z-index:0;background:#f5f6fb}
#bglayer .aurora{position:absolute;border-radius:50%;filter:blur(100px);opacity:.5}
#orbPink{width:1100px;height:1100px;left:-220px;top:-400px;background:radial-gradient(circle,rgba(255,60,232,.5),rgba(255,60,232,0) 65%);animation:driftPink 9s ease-in-out infinite alternate}
#orbBlue{width:1200px;height:1200px;right:-280px;bottom:-440px;background:radial-gradient(circle,rgba(93,198,255,.6),rgba(93,198,255,0) 65%);animation:driftBlue 9s ease-in-out infinite alternate}
#bglayer .grain{position:absolute;inset:0;opacity:.45;background-image:radial-gradient(rgba(10,37,64,.05) 1px,transparent 1px);background-size:4px 4px}
@keyframes driftPink{from{transform:translate(0,0)}to{transform:translate(60px,45px)}}
@keyframes driftBlue{from{transform:translate(0,0)}to{transform:translate(-55px,-30px)}}
/* nav lives in 1920x1080 design space, scaled to match the box, so it stays INSIDE the presentation */
#navlayer{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;pointer-events:none;z-index:2}
#navlayer>*{pointer-events:auto}
/* persistent corner logo — also in the shell; fades in once after the welcome screen, then stays put (no flash) */
#logomark{position:absolute;top:52px;left:64px;height:30px;pointer-events:none;opacity:0;transition:opacity .5s ease}
#logomark.show{opacity:1}
.scrim{position:absolute;left:0;right:0;bottom:0;height:190px;background:linear-gradient(to top,rgba(245,246,251,.97),rgba(245,246,251,0));pointer-events:none}
.skip{position:absolute;top:40px;right:56px;font-size:21px;font-weight:600;color:#5b6b80;background:rgba(255,255,255,.82);border:1px solid rgba(10,37,64,.08);padding:11px 22px;border-radius:99px;cursor:pointer}
.dots{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;display:flex;gap:12px}
.dot{width:11px;height:11px;border-radius:99px;background:rgba(10,37,64,.18);cursor:pointer;border:none;padding:0;transition:all .2s}
.dot.active{background:#0a2540;transform:scale(1.2)}.dot.done{background:#5dc6ff}
.nav{position:absolute;left:0;right:0;bottom:0;height:128px;display:flex;align-items:center;justify-content:space-between;padding:0 76px}
button.btn{font-family:inherit;font-size:24px;font-weight:700;cursor:pointer;border:none;border-radius:99px}
.back{background:rgba(255,255,255,.92);color:#0a2540;border:1px solid rgba(10,37,64,.12);padding:15px 34px;box-shadow:0 8px 24px rgba(10,37,64,.06)}
.back[hidden]{visibility:hidden}
.cont{background:#0a2540;color:#fff;padding:16px 42px;box-shadow:0 12px 30px rgba(10,37,64,.22)}
.cont[hidden]{display:none}
.cont:active,.back:active{transform:translateY(1px)}
</style></head><body>
<div id="stagebox">
<div id="bglayer"><div class="aurora" id="orbPink"></div><div class="aurora" id="orbBlue"></div><div class="grain"></div></div>
<iframe id="frame"></iframe>
<div id="navlayer">
<img id="logomark" src="keepance-logo.svg" alt="Keepance"/>
<div class="scrim"></div>
<button class="skip" id="skip">Skip setup</button>
<div class="dots" id="dots"></div>
<div class="nav"><button class="btn back" id="back">&larr; Back</button><button class="btn cont" id="cont">Continue &rarr;</button></div>
</div>
</div>
<script>
const scenes=__SCENES__;
const frame=document.getElementById('frame'),back=document.getElementById('back'),cont=document.getElementById('cont'),dotsWrap=document.getElementById('dots');
const stagebox=document.getElementById('stagebox'),navlayer=document.getElementById('navlayer'),bglayer=document.getElementById('bglayer'),logomark=document.getElementById('logomark');
function fitLayers(){const s=stagebox.clientWidth/1920,t='translate(-50%,-50%) scale('+s+')';navlayer.style.transform=t;bglayer.style.transform=t;}
window.addEventListener('resize',fitLayers);window.addEventListener('load',fitLayers);fitLayers();
let i=0;
scenes.forEach((_,idx)=>{const d=document.createElement('button');d.className='dot';d.title='Step '+(idx+1);d.onclick=()=>show(idx);dotsWrap.appendChild(d);});
const dots=[...dotsWrap.children];
function show(n){i=(n+scenes.length)%scenes.length;frame.src=scenes[i].file;back.hidden=i===0;cont.hidden=i===0;cont.innerHTML=scenes[i].cont;logomark.classList.toggle('show',i!==0);dots.forEach((d,idx)=>{d.classList.toggle('active',idx===i);d.classList.toggle('done',idx<i);});}
cont.onclick=()=>show(i===scenes.length-1?0:i+1);
back.onclick=()=>show(i-1);
window.addEventListener('message',function(e){if(e.data==='kp-advance')show(i===scenes.length-1?0:i+1);});
document.getElementById('skip').onclick=()=>show(scenes.length-1);
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='Enter')show(i===scenes.length-1?0:i+1);if(e.key==='ArrowLeft')show(i-1);});
show(0);
</script></body></html>"""
open(os.path.join(OUT,"index.html"),"w").write(SHELL.replace("__SCENES__",scene_js))
print(f"wrote {len(scenes)} advisor-aimed live scenes + shell to {OUT}")
