#!/usr/bin/env python3
# Keepance onboarding — V2 "RADICALLY CONCISE": 1 intro + 3 ACTION screens.
# AUDIENCE: financial advisors. Unit = client / household.
# This is the v2 draft (4 screens). The original 12-scene version lives in
# ../onboarding-prototype and stays live on :8902 for comparison.
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
.scene-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 300px 96px}
.scene-content.act{padding:84px 150px 150px}
.logo-big{height:32px;margin-bottom:100px}
.picon{width:17px;height:17px;color:#1f74c4;flex-shrink:0}
.eyebrow{font-size:21px;font-weight:700;letter-spacing:7px;color:#5b6b80;margin-bottom:26px}
.underline{height:8px;width:240px;border-radius:99px;margin:30px 0 30px;background:#1f74c4;transform-origin:center}
.headline{font-size:56px;font-weight:800;line-height:1.12;letter-spacing:-1.5px;max-width:1340px}
.act .headline{font-size:46px;letter-spacing:-1px;max-width:1180px}
.sub{font-size:25px;font-weight:500;color:rgba(10,37,64,.72);max-width:1000px;line-height:1.55;margin-top:26px}
.act .sub{font-size:22px;margin-top:18px;max-width:1040px}
.row{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;margin-top:46px;max-width:1300px}
.pill{font-size:20px;font-weight:600;background:rgba(255,255,255,.92);border:1px solid rgba(10,37,64,.08);box-shadow:0 8px 30px rgba(10,37,64,.06);padding:13px 24px;border-radius:99px;display:flex;align-items:center;gap:10px}
.dot{width:10px;height:10px;border-radius:99px;flex-shrink:0}
.cta{font-size:24px;font-weight:700;color:#fff;background:#1f74c4;background-image:none;padding:16px 42px;border-radius:99px;box-shadow:0 12px 30px rgba(10,37,64,.22);border:none;cursor:pointer;font-family:inherit}
.cta:active{transform:translateY(1px)}

/* ---- screen 2: choose how the AI runs (two EVEN options) ---- */
.choices{display:flex;gap:26px;margin-top:100px;justify-content:center;align-items:flex-start;max-width:1180px}
.choice{position:relative;background:#fff;border:2px solid rgba(10,37,64,.10);box-shadow:0 16px 46px rgba(10,37,64,.08);border-radius:22px;padding:36px 36px 34px;width:556px;text-align:left;cursor:pointer;transition:box-shadow .18s,border-color .18s,transform .18s}
.choice:hover{transform:translateY(-3px);box-shadow:0 22px 56px rgba(10,37,64,.12)}
.choice.sel{border-color:#5dc6ff;box-shadow:0 0 0 3px rgba(93,198,255,.55),0 22px 56px rgba(10,37,64,.14)}
.choice .ct{font-size:27px;font-weight:800;margin-bottom:14px;letter-spacing:-.4px}
.choice .cb{font-size:19px;font-weight:400;color:rgba(10,37,64,.68);line-height:1.6}
.choice .provs{margin-top:16px;font-size:17px;font-weight:600;color:#5b6b80;letter-spacing:.3px}
.seltag{position:absolute;top:-13px;right:22px;display:none;align-items:center;gap:7px;font-size:14px;font-weight:800;color:#fff;background:#1f74c4;padding:7px 15px;border-radius:99px;box-shadow:0 8px 22px rgba(10,37,64,.16)}
.choice.sel .seltag{display:inline-flex}
.choice .reveal{display:none}
/* instant display on select (no opacity animation): a click-to-expand form should feel
   immediate, and it can never freeze half-faded in a throttled/backgrounded tab. */
.choice.sel .reveal{display:block;margin-top:18px}
.specs{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.spec{font-size:15px;font-weight:600;color:#0a2540;background:#f5f7fb;border:1px solid rgba(10,37,64,.08);border-radius:99px;padding:9px 15px;display:flex;align-items:center;gap:8px}
.spec .sdot{width:7px;height:7px;border-radius:99px;background:#5dc6ff;flex-shrink:0}
.rlabel{font-size:13px;font-weight:700;letter-spacing:1.4px;color:#8a93a3;margin-bottom:9px}
.seg{display:flex;gap:8px}
.segbtn{flex:1;font-family:inherit;font-size:16px;font-weight:700;color:#5b6b80;background:#f5f7fb;border:1px solid rgba(10,37,64,.1);border-radius:11px;padding:10px 8px;cursor:pointer;transition:all .14s}
.segbtn:hover{border-color:#5dc6ff}
.segbtn.on{background:#1f74c4;color:#fff;border-color:#1f74c4}
.provdetail{margin-top:14px}
.provdetail:empty{display:none}
.trainline{font-size:15px;font-weight:600;color:#0a2540;line-height:1.45;display:flex;gap:8px}
.trainline .tdot{width:8px;height:8px;border-radius:99px;background:#5dc6ff;margin-top:5px;flex-shrink:0}
.getkey{margin-top:10px;font-size:15px;font-weight:500;color:rgba(10,37,64,.7);line-height:1.45}
.klink{color:#0a2540;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.provdetail .keyrow{margin-top:12px}
.blist{margin-top:22px;display:flex;flex-direction:column;gap:15px}
.bitem{display:flex;align-items:flex-start;gap:11px;font-size:18px;font-weight:500;color:#0a2540;line-height:1.4}
.bcheck{color:#5dc6ff;font-weight:800;font-size:18px;flex-shrink:0;margin-top:1px}
.steps{margin:2px 0 0;padding:0;list-style:none;counter-reset:s}
.steps li{position:relative;padding-left:36px;margin-bottom:11px;font-size:15px;color:rgba(10,37,64,.78);line-height:1.45}
.steps li:last-child{margin-bottom:0}
.steps li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:-1px;width:25px;height:25px;border-radius:99px;background:#1f74c4;color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center}
.paynote{margin-top:12px;font-size:14px;font-weight:500;color:#8a93a3;line-height:1.45}
.helplink{display:inline-block;margin-top:14px;font-size:15px;font-weight:700;color:#0a2540;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.helplink:hover{color:#5b6b80}
/* ---- screen 1: animated Lottie step icons ---- */
.ficon{width:188px;height:188px;display:flex;align-items:center;justify-content:center}
.ficon svg,.ficon canvas{width:100%!important;height:100%!important;display:block}
.whatlink{font-family:inherit;font-size:14px;font-weight:500;color:#1f74c4;background:none;border:none;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0;margin-left:5px;white-space:nowrap}
.switchnote{margin-top:12px;font-size:15px;font-weight:500;color:#8a93a3;text-align:center}
.modal{position:absolute;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(10,37,64,.45)}
.modal.show{display:flex}
.modalbox{position:relative;background:#fff;border-radius:22px;box-shadow:0 30px 80px rgba(10,37,64,.32);padding:40px 44px 36px;width:780px;max-width:780px;text-align:left}
.modalbox h3{font-size:30px;font-weight:800;color:#0a2540;margin-bottom:18px;letter-spacing:-.5px}
.modalbox p{font-size:20px;font-weight:400;color:rgba(10,37,64,.78);line-height:1.6;margin:0}
.modalclose{position:absolute;top:16px;right:22px;font-size:34px;line-height:1;color:#9aa4b4;cursor:pointer;background:none;border:none;font-family:inherit}
.modalgot{margin-top:26px;font-family:inherit;font-size:19px;font-weight:700;color:#fff;background:#1f74c4;border:none;border-radius:99px;padding:14px 34px;cursor:pointer}
.capnote{font-size:16px;font-weight:500;color:rgba(10,37,64,.72);line-height:1.45}
.dlbreak{margin-top:13px;display:flex;flex-direction:column;gap:7px}
.dlrow{display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#0a2540;border-bottom:1px dashed rgba(10,37,64,.13);padding-bottom:6px}
.dlrow .sz{color:#5b6b80;font-weight:600}
.keyrow{display:flex;gap:10px}
.kinput{flex:1;font-family:inherit;font-size:17px;font-weight:500;color:#0a2540;background:#f5f7fb;border:1px solid rgba(10,37,64,.12);border-radius:12px;padding:13px 16px;outline:none}
.kinput::placeholder{color:#9aa4b4}
.mini{font-family:inherit;font-size:17px;font-weight:700;color:#fff;background:#1f74c4;border:none;border-radius:12px;padding:13px 22px;cursor:pointer;white-space:nowrap}
.mini.wide{width:100%}
.mini:active{transform:translateY(1px)}
.rnote{margin-top:11px;font-size:15px;font-weight:500;color:#8a93a3}
.later{margin-top:60px;font-family:inherit;font-size:19px;font-weight:600;color:#5b6b80;background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:5px;text-decoration-color:rgba(10,37,64,.25)}
.later:hover{color:#0a2540}

/* ---- screen 3: connect the data ---- */
.connect-grid{display:flex;gap:22px;justify-content:center;margin-top:40px;max-width:1180px}
.ctile{position:relative;background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 14px 40px rgba(10,37,64,.07);border-radius:20px;padding:40px 26px 32px;width:344px;display:flex;flex-direction:column;align-items:center;gap:24px;transition:box-shadow .18s,border-color .18s}
.ctile.connected{border-color:#5dc6ff;box-shadow:0 0 0 2px rgba(93,198,255,.5),0 16px 44px rgba(10,37,64,.1)}
.ctile .tlogo{height:48px;max-width:218px;object-fit:contain}
.ctile .tname{font-size:22px;font-weight:700}
.ctile .tcat{font-size:13px;font-weight:700;letter-spacing:1.4px;color:#8a93a3;margin-top:-8px}
.connectbtn{font-family:inherit;font-size:18px;font-weight:700;color:#0a2540;background:#fff;border:1.5px solid rgba(10,37,64,.16);border-radius:99px;padding:11px 30px;cursor:pointer;margin-top:4px;transition:all .16s}
.connectbtn:hover{border-color:#0a2540}
.ctile.connected .connectbtn{background:#1f74c4;color:#fff;border-color:transparent}
.morelabel{margin-top:42px;font-size:16px;font-weight:700;letter-spacing:2px;color:#8a93a3}
.morelogos{display:flex;gap:30px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:18px;max-width:1100px}
.morelogos img{height:26px;max-width:150px;object-fit:contain;opacity:.42;filter:grayscale(1)}
.soon{margin-top:60px;width:760px;max-width:760px;background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 12px 34px rgba(10,37,64,.06);border-radius:20px;padding:22px 30px 26px}
.soonlabel{font-size:13px;font-weight:700;letter-spacing:1.8px;color:#8a93a3;text-align:center;margin-bottom:18px}
.soongrid{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:22px 38px}
.soongrid img{height:26px;max-width:128px;object-fit:contain;opacity:.55;filter:grayscale(1)}
.soonchip{font-size:16px;font-weight:700;color:#8a93a3;background:#f1f4f8;border-radius:8px;padding:7px 14px}

/* ---- screen 4: ask the first question (the aha) ---- */
.chatwrap{margin-top:34px;width:1060px;max-width:1060px;background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 22px 60px rgba(10,37,64,.12);border-radius:24px;padding:26px 30px 30px;text-align:left}
.clienthdr{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:700;color:#0a2540;padding-bottom:18px;border-bottom:1px solid rgba(10,37,64,.07);margin-bottom:20px}
.clienthdr .badge{font-size:13px;font-weight:700;color:#5b6b80;background:#eef1f7;padding:5px 12px;border-radius:99px;letter-spacing:.4px}
.avatar{width:38px;height:38px;border-radius:99px;background:#1f74c4;color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center}
.qprompt{font-size:16px;font-weight:700;letter-spacing:.4px;color:#8a93a3;margin-bottom:14px}
.qchips{display:flex;flex-direction:column;gap:12px}
.qchip{font-family:inherit;text-align:left;font-size:20px;font-weight:600;color:#0a2540;background:#f5f7fb;border:1px solid rgba(10,37,64,.08);border-radius:15px;padding:16px 22px;cursor:pointer;transition:all .16s;display:flex;align-items:center;gap:12px}
.qchip:hover{background:#fff;border-color:#5dc6ff;box-shadow:0 10px 26px rgba(10,37,64,.08)}
.qchip .qmark{color:#5dc6ff;font-weight:800;font-size:22px}
.thread{display:flex;flex-direction:column;gap:16px}
.bubble{font-size:20px;line-height:1.5;border-radius:18px;padding:16px 22px;max-width:88%}
.bubble.user{align-self:flex-end;background:#1f74c4;color:#fff;font-weight:600;border-bottom-right-radius:6px}
.bubble.ai{align-self:flex-start;background:#f5f7fb;color:#0a2540;font-weight:500;border-bottom-left-radius:6px;border:1px solid rgba(10,37,64,.06)}
.typing{align-self:flex-start;background:#f5f7fb;border:1px solid rgba(10,37,64,.06);border-radius:18px;border-bottom-left-radius:6px;padding:18px 22px;display:flex;gap:7px}
.typing span{width:10px;height:10px;border-radius:99px;background:#b7c0cf;animation:bounce 1s infinite}
.typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-6px);opacity:1}}
.cites{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.citelabel{width:100%;font-size:13px;font-weight:700;letter-spacing:1.4px;color:#8a93a3;margin-bottom:2px}
.cite{font-size:16px;font-weight:600;color:#0a2540;background:#fff;border:1px solid rgba(10,37,64,.12);border-radius:11px;padding:9px 15px;display:flex;align-items:center;gap:9px;cursor:pointer;transition:all .16s}
.cite:hover{border-color:#5dc6ff;box-shadow:0 8px 20px rgba(10,37,64,.07)}
.cite .cdot{width:9px;height:9px;border-radius:99px;flex-shrink:0}
.askcta{margin-top:30px;display:none;justify-content:center}
/* dynamic chat reveal uses a CSS animation whose RESTING state is visible (opacity:1),
   so a throttled/backgrounded tab can never freeze a bubble half-faded the way a JS
   rAF tween can. no fill-mode: before/after the run the element keeps its visible base. */
@keyframes riseIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.anim{animation:riseIn .42s ease}

/* ---- screen 1: journey flowchart + security through-line ---- */
.flow{display:flex;align-items:stretch;justify-content:center;margin-top:42px}
.fnode{background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 12px 34px rgba(10,37,64,.07);border-radius:18px;padding:26px 24px;width:298px;display:flex;flex-direction:column;align-items:center;gap:15px;text-align:center}
.fnum{width:46px;height:46px;border-radius:99px;background:#1f74c4;color:#fff;font-size:21px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(93,198,255,.32)}
.ftitle{font-size:21px;font-weight:700;line-height:1.25;color:#0a2540}
.farrow{display:flex;align-items:center;justify-content:center;width:108px;flex-shrink:0}
.farrow b{font-size:74px;font-weight:400;line-height:1;color:#1f74c4}
.secband{margin-top:36px;display:inline-flex;align-items:center;justify-content:center;flex-wrap:wrap;background:linear-gradient(90deg,rgba(255,60,232,.06),rgba(93,198,255,.11));border:1px solid rgba(10,37,64,.08);border-radius:99px;padding:13px 14px}
.secitem{font-size:17px;font-weight:600;color:#0a2540;padding:4px 24px;border-right:1px solid rgba(10,37,64,.14)}
.secitem:last-child{border-right:none}
.secnote{margin-top:16px;font-size:15px;font-weight:500;color:#5b6b80;max-width:900px;line-height:1.5}

/* ---- screen 4: live setup / progress ---- */
.setpanel{margin-top:100px;width:1080px;max-width:1080px;background:#fff;border:1px solid rgba(10,37,64,.08);box-shadow:0 22px 60px rgba(10,37,64,.12);border-radius:24px;padding:22px 32px 26px;text-align:left}
.seclabel{font-size:13px;font-weight:700;letter-spacing:1.6px;color:#8a93a3;margin:8px 0 2px}
.prow{display:flex;align-items:center;gap:18px;padding:13px 0}
.plabel{width:236px;flex-shrink:0;font-size:18px;font-weight:600;color:#0a2540;display:flex;align-items:center;gap:11px}
.plabel img{height:30px;width:auto;max-width:150px;object-fit:contain}
.pbar{flex:1;height:10px;border-radius:99px;background:#eef1f7;overflow:hidden;position:relative}
.pfill{height:100%;border-radius:99px;background:#1fa971;position:relative;overflow:hidden}
.pfill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-100%);animation:shimmer 1.6s infinite}
@keyframes shimmer{to{transform:translateX(100%)}}
.ppct{width:50px;text-align:right;font-size:16px;font-weight:700;color:#5b6b80}
.maprow{margin-top:50px;background:rgba(31,169,113,.08);border:1px solid rgba(31,169,113,.3);border-radius:16px;padding:15px 20px}
.maptop{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:800;color:#0a2540}
.mapsub{font-size:15px;font-weight:500;color:rgba(10,37,64,.62);margin-top:3px}
.mapbar{margin-top:11px;height:10px;border-radius:99px;background:rgba(255,255,255,.65);overflow:hidden;position:relative}
.mapbar i{position:absolute;top:0;height:100%;width:38%;border-radius:99px;background:#1fa971;animation:indet 1.7s ease-in-out infinite}
@keyframes indet{0%{left:-40%}100%{left:102%}}
.setdiv{height:1px;background:rgba(10,37,64,.08);margin:18px 0 14px}
.askhdr{font-size:19px;font-weight:700;color:#0a2540;text-align:center;margin-top:28px}
.askrow{display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:11px;margin-top:14px;width:1060px;max-width:1060px;max-height:112px;overflow-y:auto;padding:4px 14px}
.askrow::-webkit-scrollbar{width:9px}
.askrow::-webkit-scrollbar-track{background:transparent}
.askrow::-webkit-scrollbar-thumb{background:rgba(10,37,64,.16);border-radius:99px}
.askq{font-size:16px;font-weight:600;color:#0a2540;background:#f5f7fb;border:1px solid rgba(10,37,64,.08);border-radius:12px;padding:11px 16px;display:flex;align-items:center;gap:9px}
.askq .qmark{color:#5dc6ff;font-weight:800;font-size:18px}
.setbtns{display:flex;justify-content:center;gap:14px;margin-top:60px}
.btn-skip{font-family:inherit;font-size:19px;font-weight:600;color:#5b6b80;background:#fff;border:1px solid rgba(10,37,64,.14);border-radius:99px;padding:14px 32px;cursor:pointer}
.btn-skip:active,.btn-go:active{transform:translateY(1px)}
.btn-go{font-family:inherit;font-size:19px;font-weight:700;color:#fff;background:#1f74c4;border:none;border-radius:99px;padding:14px 36px;cursor:pointer;box-shadow:0 12px 30px rgba(10,37,64,.2)}

/* ---- screen 2: Anthropic API key verify status ---- */
.vstatus{margin-top:15px;font-size:16px;font-weight:600;display:none;align-items:center;gap:10px}
.vstatus.checking{display:flex;color:#5b6b80}
.vstatus.ok{display:flex;color:#1fa971}
.vspin{width:18px;height:18px;border-radius:99px;border:2.5px solid rgba(10,37,64,.18);border-top-color:#1f74c4;animation:vspin .7s linear infinite;flex-shrink:0}
@keyframes vspin{to{transform:rotate(360deg)}}
.vtick{width:22px;height:22px;border-radius:99px;background:#1fa971;color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.costnote{margin-top:12px;font-size:14px;font-weight:500;color:#8a93a3;line-height:1.45}

/* ---- screen 3: per-connector status + Wealthbox key field ---- */
.ctile .cstatus{min-height:26px;margin-top:-6px;font-size:16px;font-weight:600;color:#5b6b80;display:flex;align-items:center;gap:9px;justify-content:center;text-align:center;line-height:1.35}
.ctile .cstatus.ok{color:#1fa971;font-weight:700}
.cspin{width:16px;height:16px;border-radius:99px;border:2.5px solid rgba(10,37,64,.18);border-top-color:#1f74c4;animation:vspin .7s linear infinite;flex-shrink:0}
.ctile.connected{border-color:#1fa971;box-shadow:0 0 0 2px rgba(31,169,113,.4),0 16px 44px rgba(10,37,64,.1)}
.ctile.connected .connectbtn{background:#1fa971;color:#fff;border-color:transparent}
.wbkey{width:100%;font-family:inherit;font-size:15px;font-weight:600;color:#0a2540;background:#f5f7fb;border:1px solid rgba(10,37,64,.12);border-radius:12px;padding:11px 14px;outline:none;text-align:center;letter-spacing:.03em}
.wbkey::placeholder{color:#9aa4b4;letter-spacing:0;font-weight:500}
.wbhelp{font-size:13px;font-weight:500;color:#8a93a3;line-height:1.4;text-align:center;margin-top:-10px}
.ctick{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:99px;background:#1fa971;color:#fff;font-size:12px;font-weight:800;flex-shrink:0}

/* ---- screen 3: portrayed Microsoft sign-in webpage (covers the scene, like a real browser page) ---- */
#mssignin{position:fixed;inset:0;z-index:200;background:#f3f3f3;display:none;flex-direction:column;font-family:'Segoe UI','Sora',system-ui,sans-serif}
#mssignin.show{display:flex}
#mssignin .msbar{height:64px;flex-shrink:0;background:#e6e6e6;border-bottom:1px solid #d0d0d0;display:flex;align-items:center;gap:14px;padding:0 30px;font-size:22px;color:#444}
#mssignin .msurl{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ccc;border-radius:8px;padding:9px 18px;font-size:21px;color:#333;min-width:560px}
#mssignin .msbody{flex:1;display:flex;align-items:center;justify-content:center}
#mssignin .mscard{background:#fff;width:760px;box-shadow:0 2px 14px rgba(0,0,0,.13);padding:54px 56px 46px}
#mssignin .mslogo{display:flex;align-items:center;gap:10px;font-size:26px;font-weight:600;color:#5e5e5e;margin-bottom:30px}
#mssignin .msgrid{display:grid;grid-template-columns:13px 13px;grid-template-rows:13px 13px;gap:3px;margin-right:4px}
#mssignin .msgrid i{display:block;width:13px;height:13px}
#mssignin .msh{font-size:34px;font-weight:600;color:#1b1b1b;margin-bottom:26px}
#mssignin .msacct{display:flex;align-items:center;gap:18px;width:100%;border:none;background:#fff;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:20px 6px;cursor:pointer;text-align:left;transition:background .12s}
#mssignin .msacct:hover{background:#f5f5f5}
#mssignin .msav{width:54px;height:54px;border-radius:99px;background:#0a7;background:linear-gradient(135deg,#1f74c4,#5dc6ff);color:#fff;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#mssignin .msacct-meta{display:flex;flex-direction:column;gap:3px}
#mssignin .msacct-meta b{font-size:24px;font-weight:600;color:#1b1b1b}
#mssignin .msacct-meta i{font-size:21px;font-style:normal;color:#666}
#mssignin .msconsent{margin-top:30px;font-size:21px;color:#444;line-height:1.5}
#mssignin .msconsent b{font-weight:600;color:#1b1b1b}

/* ---- screen 4: AI connected (done) badge ---- */
.aidone{display:flex;align-items:center;gap:13px;font-size:18px;font-weight:700;color:#0a2540;padding:12px 0}
.aidone .adtick{width:27px;height:27px;border-radius:99px;background:#1fa971;color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.aidone .adsub{font-size:15px;font-weight:600;color:#8a93a3;margin-left:auto}

/* anti-flash: hide animating elements before first paint; GSAP reveals them (or the JS failsafe at 4s does).
   the bg + corner logo live in the shell, so they never reload between scenes. */
.logo-big,.eyebrow,.headline,.sub,.item{opacity:0}
.underline{transform:scaleX(0)}
"""

# Each scene: (id, continue-button-label, body-html, interactivity-script)
scenes = [
 # 1) INTRO — the hook. folds welcome + advisors + ecosystem + clients value into one breath.
 ("intro", "Get started", """
  <img class="logo-big" src="keepance-logo.svg" alt="Keepance" />
  <div class="headline">A private AI that knows your clients.</div>
  <div class="flow" style="margin-top:100px">
    <div class="fnode item"><div class="ficon" data-lottie="lottie/step1.json"></div><div class="ftitle">Connect your<br/>AI and files</div></div>
    <div class="farrow item"><b>&rarr;</b></div>
    <div class="fnode item"><div class="ficon" data-lottie="lottie/step2.json"></div><div class="ftitle">Keepance builds<br/>Client Maps</div></div>
    <div class="farrow item"><b>&rarr;</b></div>
    <div class="fnode item"><div class="ficon" data-lottie="lottie/step3.json"></div><div class="ftitle">Ask anything,<br/>with sources</div></div>
  </div>
  <div class="row" style="margin-top:60px">
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6"/><path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>Keepance stores none of your data</div>
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Fully encrypted (AES-256)</div>
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg>AI provider is SOC 2 certified</div>
  </div>
  <button type="button" class="cta item" style="margin-top:52px" onclick="parent.postMessage('kp-advance','*')">Go!</button>
 """, """
  // Animated step icons via lottie-web (loaded on demand). Each .ficon renders its JSON.
  (function(){
    function initLottie(){
      try{
        document.querySelectorAll('.ficon').forEach(function(el){
          if(el.dataset.done)return; el.dataset.done='1';
          lottie.loadAnimation({container:el,renderer:'svg',loop:true,autoplay:true,path:el.getAttribute('data-lottie')});
        });
      }catch(e){}
    }
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js';
    s.onload=initLottie;s.onerror=function(){};
    document.head.appendChild(s);
  })();
 """),

 # 2) ACTION — power your AI. two EVEN options + decide later. in-context honesty replaces teach1-4.
 ("power", "Continue", """
  <div class="headline">1. Connect your AI</div>
  <div class="choices">
   <div class="choice item" data-k="key">
     <div class="ct">Use ChatGPT, Claude, or Gemini</div>
     <div class="blist">
       <div class="bitem"><span class="bcheck">&#10003;</span>Keepance never sees your key or your data</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Providers are SOC 2 Type 2 certified</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Encrypted in transit and at rest</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Providers don't train on your data (on paid API usage)</div>
       <div class="bitem"><span class="bcheck">&#10003;</span><span>Pay as you go with your own key <button type="button" class="whatlink">What is this?</button></span></div>
     </div>
     <div class="rlabel" style="margin-top:22px">PICK YOUR PROVIDER, THEN GET YOUR KEY</div>
     <div class="seg">
       <button type="button" class="segbtn" data-p="openai">OpenAI</button>
       <button type="button" class="segbtn" data-p="anthropic">Anthropic</button>
       <button type="button" class="segbtn" data-p="google">Google</button>
     </div>
     <div class="provdetail" id="provdetail"></div>
   </div>
   <div class="choice item" data-k="local">
     <div class="ct">Use local AI</div>
     <div class="blist">
       <div class="bitem"><span class="bcheck">&#10003;</span>Runs on your computer</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Completely secure (nothing leaves)</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>2.5 GB download (about 5 minutes)</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Great at answering questions about lots of files</div>
       <div class="bitem"><span class="bcheck">&#10003;</span>Not as great with complex reasoning</div>
       <div class="bitem"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><button type="button" class="whatlink localmore">Tell me more</button></div>
     </div>
     <button type="button" class="mini wide trylocal" style="margin-top:22px">Try Local AI</button>
     <div class="switchnote">Switch to cloud AI anytime</div>
   </div>
  </div>
  <div class="modal" id="payModal">
    <div class="modalbox">
      <button type="button" class="modalclose" data-close>&times;</button>
      <h3>Pay as you go, with your own key</h3>
      <p>You get an API key from the AI company you pick (OpenAI, Anthropic, or Google). You pay them directly, only for what you actually use, usually a few cents per question. Keepance never charges you for AI, and never sees your key or your data.</p>
      <button type="button" class="modalgot" data-close>Got it</button>
    </div>
  </div>
  <div class="modal" id="localModal">
    <div class="modalbox">
      <button type="button" class="modalclose" data-close>&times;</button>
      <h3>Local AI, explained</h3>
      <p>Local AI runs entirely on your own computer. It's free, and fully private, so nothing ever leaves your machine. It's a one time download of about 2.5 GB. It's great at answering questions across lots of your files, though not as strong on complex reasoning. You can switch to cloud AI any time.</p>
      <button type="button" class="modalgot" data-close>Got it</button>
    </div>
  </div>
 """, """
  const PROV={
    openai:{n:'OpenAI',u:'https://platform.openai.com/api-keys'},
    anthropic:{n:'Anthropic',u:'https://console.anthropic.com/settings/keys'},
    google:{n:'Google',u:'https://aistudio.google.com/app/apikey'}
  };
  const detail=document.getElementById('provdetail');
  const segbtns=[].slice.call(document.querySelectorAll('.segbtn'));
  segbtns.forEach(function(b){
    b.addEventListener('click',function(){
      const p=PROV[b.getAttribute('data-p')];
      segbtns.forEach(function(x){x.classList.toggle('on',x===b);});
      detail.innerHTML='<ol class="steps">'
        +'<li>Open <a class="klink" href="'+p.u+'" target="_blank" rel="noopener">the '+p.n+' API keys page</a> and sign in.</li>'
        +'<li>Create a key.</li>'
        +'<li>Paste it below.</li>'
        +'</ol>'
        +'<div class="keyrow"><input class="kinput" id="provkey" placeholder="sk-ant-api03-..." /><button type="button" class="mini" id="savekey">Save key</button></div>'
        +'<div class="vstatus" id="vstatus"></div>'
        +'<div class="costnote">Your key is stored on this computer and never leaves your machine. Typical professional use: $2-5/month on Claude Haiku.</div>';
      var sk=document.getElementById('savekey');
      if(sk)sk.addEventListener('click',function(){
        var vs=document.getElementById('vstatus');if(!vs)return;
        vs.className='vstatus checking';
        vs.innerHTML='<span class="vspin"></span>Checking your key with '+p.n+'\\u2026';
        setTimeout(function(){
          vs.className='vstatus ok';
          vs.innerHTML='<span class="vtick">\\u2713</span>Key verified.';
        },1200);
      });
    });
  });
  function closeModals(){document.querySelectorAll('.modal').forEach(function(m){m.classList.remove('show');});}
  document.querySelectorAll('.modal').forEach(function(m){
    m.addEventListener('click',function(e){if(e.target===m)closeModals();});
    m.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',closeModals);});
  });
  var payLink=document.querySelector('.whatlink:not(.localmore)');
  if(payLink)payLink.addEventListener('click',function(e){e.stopPropagation();document.getElementById('payModal').classList.add('show');});
  var moreLink=document.querySelector('.localmore');
  if(moreLink)moreLink.addEventListener('click',function(e){e.stopPropagation();document.getElementById('localModal').classList.add('show');});
  var tl=document.querySelector('.trylocal');
  if(tl)tl.addEventListener('click',function(e){e.stopPropagation();parent.postMessage('kp-advance','*');});
 """),

 # 3) ACTION — connect the client data. folds ecosystem + email into one. real logos. connect or skip.
 ("connect", "Continue", """
  <div class="headline">2. Securely connect your data</div>
  <div class="connect-grid" style="margin-top:54px;align-items:flex-start">
   <div class="ctile item" data-conn="onedrive">
     <img class="tlogo" src="logos/onedrive.svg" alt="OneDrive" />
     <div class="cstatus"></div>
     <button type="button" class="connectbtn">Connect OneDrive</button>
   </div>
   <div class="ctile item" data-conn="m365">
     <img class="tlogo" src="logos/outlook.svg" alt="Microsoft 365" />
     <div class="cstatus"></div>
     <button type="button" class="connectbtn">Connect Microsoft 365</button>
   </div>
   <div class="ctile item" data-conn="wealthbox">
     <img class="tlogo" src="logos/wealthbox.svg" alt="Wealthbox" />
     <input class="wbkey" placeholder="Wealthbox API key" />
     <div class="cstatus"></div>
     <button type="button" class="connectbtn">Connect Wealthbox</button>
   </div>
  </div>
  <div class="row" style="margin-top:30px">
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Read-only access</div>
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>Stays on your device</div>
    <div class="pill item"><svg class="picon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.06 6.06A18.45 18.45 0 0 0 1 12s4 8 11 8a9.12 9.12 0 0 0 3.36-.64"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>Keepance never sees your data</div>
  </div>
  <div class="soon item">
    <div class="soonlabel">COMING SOON</div>
    <div class="soongrid">
      <img src="logos/redtail.svg" alt="Redtail"/>
      <img src="logos/salesforce.svg" alt="Salesforce"/>
      <img src="logos/rightcapital.svg" alt="RightCapital"/>
      <img src="logos/emoney.svg" alt="eMoney"/>
      <img src="logos/moneyguidepro.svg" alt="MoneyGuidePro"/>
      <img src="logos/holistiplan.png" alt="Holistiplan"/>
      <img src="logos/orion.svg" alt="Orion"/>
      <img src="logos/tamarac.svg" alt="Tamarac"/>
      <img src="logos/addepar.svg" alt="Addepar"/>
      <img src="logos/nitrogen.svg" alt="Nitrogen"/>
      <img src="logos/docusign.svg" alt="DocuSign"/>
    </div>
  </div>
  <div id="mssignin">
    <div class="msbar"><div class="msurl"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>login.microsoftonline.com</div></div>
    <div class="msbody">
      <div class="mscard">
        <div class="mslogo"><div class="msgrid"><i style="background:#f25022"></i><i style="background:#7fba00"></i><i style="background:#00a4ef"></i><i style="background:#ffb900"></i></div>Microsoft</div>
        <div class="msh">Pick an account</div>
        <button type="button" class="msacct" id="msacct">
          <span class="msav">JA</span>
          <span class="msacct-meta"><b>Jordan Avery</b><i>jordan@northcrestwealth.com</i></span>
        </button>
        <div class="msconsent">Keepance is requesting <b id="msscope">read-only access to your files</b>.</div>
      </div>
    </div>
  </div>
 """, """
  (function(){
    function tile(n){return document.querySelector('.ctile[data-conn="'+n+'"]');}
    function setStatus(t,html,ok){var s=t.querySelector('.cstatus');if(!s)return;s.className='cstatus'+(ok?' ok':'');s.innerHTML=html;}
    function spin(txt){return '<span class="cspin"></span>'+txt;}
    function tick(txt){return '<span class="ctick">✓</span>'+txt;}
    var ms=document.getElementById('mssignin'),scopeEl=document.getElementById('msscope'),acct=document.getElementById('msacct'),pending=null;
    function showMs(scope){if(scopeEl)scopeEl.textContent=scope;if(ms)ms.classList.add('show');}
    function resolveMs(){if(pending){var f=pending;pending=null;if(ms)ms.classList.remove('show');f();}}
    if(acct)acct.addEventListener('click',resolveMs);
    function importCount(t,prefix,target,suffix,step,done){
      var n=0;var iv=setInterval(function(){
        n=Math.min(target,n+step);
        setStatus(t,spin(prefix+n.toLocaleString()+suffix));
        if(n>=target){clearInterval(iv);setTimeout(function(){setStatus(t,tick(done),true);},520);}
      },130);
    }
    function msConnect(name,waiting,scope,prefix,target,suffix,step,done){
      var t=tile(name);if(!t||t.classList.contains('connected'))return;var b=t.querySelector('.connectbtn');
      b.disabled=true;b.textContent='Waiting for sign-in…';
      setStatus(t,spin(waiting));showMs(scope);
      pending=function(){
        t.classList.add('connected');b.textContent='✓ Connected';
        setStatus(t,tick('Connected.'),true);
        setTimeout(function(){importCount(t,prefix,target,suffix,step,done);},650);
      };
      setTimeout(resolveMs,2800); // failsafe if the account is not clicked
    }
    function wbConnect(){
      var t=tile('wealthbox');var b=t.querySelector('.connectbtn');
      b.disabled=true;b.textContent='Connecting…';setStatus(t,spin('Connecting…'));
      setTimeout(function(){
        t.classList.add('connected');
        setStatus(t,tick('Connected to Northcrest Wealth (Premier).'),true);
        b.disabled=false;b.textContent='Sync now';
      },1300);
    }
    function wbSync(){
      var t=tile('wealthbox');var b=t.querySelector('.connectbtn');
      if(t.dataset.syncing)return;t.dataset.syncing='1';b.disabled=true;b.textContent='Syncing…';
      var h=0;var iv=setInterval(function(){
        h=Math.min(8,h+1);
        setStatus(t,spin('Syncing… '+h+' households, '+(h*52)+' records'));
        if(h>=8){clearInterval(iv);setTimeout(function(){
          setStatus(t,tick('Sync complete: 8 households, 416 records indexed.'),true);
          b.textContent='Sync now';b.disabled=false;t.dataset.syncing='';
        },520);}
      },240);
    }
    document.querySelectorAll('.ctile[data-conn] .connectbtn').forEach(function(b){
      b.addEventListener('click',function(){
        var t=b.closest('.ctile');var n=t.getAttribute('data-conn');
        if(n==='onedrive')msConnect('onedrive','Waiting for Microsoft sign-in…','read-only access to your files','Importing… ',128,' items checked',12,'Documents imported.');
        else if(n==='m365')msConnect('m365','Waiting for sign-in in your browser…','read-only access to your mail','Importing… ',1284,' messages so far',150,'All mail imported and searchable.');
        else if(n==='wealthbox'){if(t.classList.contains('connected'))wbSync();else wbConnect();}
      });
    });
    document.querySelectorAll('.soongrid img').forEach(function(im){
      function fail(){var s=document.createElement('span');s.className='soonchip';s.textContent=im.getAttribute('alt');if(im.parentNode)im.replaceWith(s);}
      im.addEventListener('error',fail);
      if(im.complete&&im.naturalWidth===0)fail();
    });
  })();
 """),

 # 4) ACTION — ask the first question. the AHA. one click -> a cited answer on a sample client.
 ("ask", "Continue to the app", """
  <div class="headline">3. Setting up your firm</div>
  <div class="sub">Connecting your data and building your Client Maps. You can continue to the app and these finish in the background.</div>
  <div class="setpanel item">
    <div class="seclabel">YOUR AI</div>
    <div class="aidone">
      <span class="adtick">&#10003;</span>Anthropic (Claude) connected
      <span class="adsub">Your key stays on this computer</span>
    </div>
    <div class="seclabel" style="margin-top:30px">IMPORTING YOUR DATA</div>
    <div class="prow">
      <div class="plabel"><img src="logos/outlook.svg" alt="Microsoft 365"/></div>
      <div class="pbar"><div class="pfill" style="width:81%"></div></div>
      <div class="ppct">81%</div>
    </div>
    <div class="prow">
      <div class="plabel"><img src="logos/wealthbox.svg" alt="Wealthbox"/></div>
      <div class="pbar"><div class="pfill" style="width:62%"></div></div>
      <div class="ppct">62%</div>
    </div>
    <div class="prow">
      <div class="plabel"><img src="logos/onedrive.svg" alt="OneDrive"/></div>
      <div class="pbar"><div class="pfill" style="width:48%"></div></div>
      <div class="ppct">48%</div>
    </div>
    <div class="maprow">
      <div class="maptop">Building your Client Maps</div>
      <div class="mapsub">Assembling the whole story of every client and household.</div>
      <div class="mapbar"><i></i></div>
    </div>
  </div>
  <div class="askhdr item">Things you can ask Keepance</div>
  <div class="askrow item">
    <div class="askq"><span class="qmark">?</span>Which client is doing a 1031 exchange?</div>
    <div class="askq"><span class="qmark">?</span>Who has a 529 for the kids?</div>
    <div class="askq"><span class="qmark">?</span>What changed for the Hendricks since our last review?</div>
    <div class="askq"><span class="qmark">?</span>Which clients are over-concentrated in one stock?</div>
    <div class="askq"><span class="qmark">?</span>Who turns 73 this year for RMDs?</div>
    <div class="askq"><span class="qmark">?</span>Which households haven't been contacted in 90 days?</div>
    <div class="askq"><span class="qmark">?</span>Who has a CD maturing next month?</div>
    <div class="askq"><span class="qmark">?</span>Which clients mentioned retiring early?</div>
    <div class="askq"><span class="qmark">?</span>Who is a good candidate for a Roth conversion?</div>
    <div class="askq"><span class="qmark">?</span>Which accounts are missing a beneficiary?</div>
    <div class="askq"><span class="qmark">?</span>Who had a major life event this quarter?</div>
    <div class="askq"><span class="qmark">?</span>Who has cash sitting uninvested?</div>
    <div class="askq"><span class="qmark">?</span>Which clients asked about the market last week?</div>
    <div class="askq"><span class="qmark">?</span>Who is closest to their retirement goal?</div>
    <div class="askq"><span class="qmark">?</span>Which clients hold concentrated employer stock?</div>
    <div class="askq"><span class="qmark">?</span>Who mentioned a home purchase or move?</div>
  </div>
 """, """
  // Live-ish progress: nudge each bar up toward 100, but cap it so the demo always
  // reads as "in progress." setInterval still fires in a throttled/backgrounded tab,
  // and the initial inline widths mean the very first paint already shows real progress.
  var fills=[].slice.call(document.querySelectorAll('.pfill'));
  var pcts=[].slice.call(document.querySelectorAll('.ppct'));
  var iv=setInterval(function(){
    var moving=false;
    fills.forEach(function(f,i){
      var w=parseFloat(f.style.width)||0;
      var cap=(i===0)?98:92;                 // the AI download climbs higher; imports hold mid
      if(w<cap){moving=true;w=Math.min(cap,w+((i===0)?1.4:0.8));f.style.width=w+'%';if(pcts[i])pcts[i].textContent=Math.round(w)+'%';}
    });
    if(!moving)clearInterval(iv);
  },800);
 """),
]

def timeline_lines(html):
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
        L.append("tlIn.fromTo('.item',{autoAlpha:0,y:26,scale:0.97},{autoAlpha:1,y:0,scale:1,duration:0.55,stagger:0.09,ease:'back.out(1.4)'},0.95);")
    return "\n".join(L)

SCENE_TMPL = """<!doctype html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>__CSS__</style></head>
<body>
<div id="stage">
  <div class="scene-content __ACT__">__HTML__</div>
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
<script>
__SCRIPT__
</script>
</body></html>"""

os.makedirs(OUT, exist_ok=True)
# copy brand assets in so dist/ is a complete, self-contained, servable site
for item in ("fonts","logos","lottie","keepance-logo.svg"):
    src = os.path.join(ASSETS,item); dst = os.path.join(OUT,item)
    if os.path.isdir(src): shutil.copytree(src,dst,dirs_exist_ok=True)
    elif os.path.isfile(src): shutil.copy2(src,dst)
for idx,(sid,cont,html,script) in enumerate(scenes):
    act = "" if sid=="intro" else "act"
    doc = (SCENE_TMPL.replace("__CSS__",CSS)
           .replace("__ACT__",act)
           .replace("__HTML__",html)
           .replace("__TL__",timeline_lines(html))
           .replace("__SCRIPT__",script))
    open(os.path.join(OUT,f"scene-{idx+1}.html"),"w").write(doc)

import json, time
ver = int(time.time())  # cache-bust: forces browsers to re-fetch scene files on every rebuild
scene_js = json.dumps([{"file":f"scene-{i+1}.html?v={ver}","cont":c} for i,(s,c,h,sc) in enumerate(scenes)])
SHELL = """<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Keepance onboarding — v2 concise</title>
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
/* The bottom scrim is purely decorative and the nav BAR is empty except its buttons, so
   neither must capture clicks (the blanket rule above would otherwise make them swallow
   clicks on scene content that sits over the bottom band, e.g. the "Go!" button). Only
   the actual nav buttons stay clickable. Higher specificity than #navlayer>*. */
#navlayer .scrim{pointer-events:none}
#navlayer .nav{pointer-events:none}
#navlayer .nav button{pointer-events:auto}
/* persistent corner logo — also in the shell; fades in once after the intro screen, then stays put (no flash) */
#logomark{position:absolute;top:52px;left:64px;height:30px;pointer-events:none;opacity:0;transition:opacity .5s ease}
#logomark.show{opacity:1}
.scrim{position:absolute;left:0;right:0;bottom:0;height:190px;background:linear-gradient(to top,rgba(245,246,251,.97),rgba(245,246,251,0));pointer-events:none}
.skip{position:absolute;top:40px;right:56px;font-size:21px;font-weight:600;color:#5b6b80;background:rgba(255,255,255,.82);border:1px solid rgba(10,37,64,.08);padding:11px 22px;border-radius:99px;cursor:pointer}
.dots{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;display:flex;gap:12px}
.dot{width:11px;height:11px;border-radius:99px;background:rgba(10,37,64,.18);cursor:pointer;border:none;padding:0;transition:all .2s}
.dot.active{background:#1f74c4;transform:scale(1.2)}.dot.done{background:#5dc6ff}
.nav{position:absolute;left:0;right:0;bottom:0;height:128px;display:flex;align-items:center;justify-content:space-between;padding:0 76px}
button.btn{font-family:inherit;font-size:24px;font-weight:700;cursor:pointer;border:none;border-radius:99px}
.back{background:rgba(255,255,255,.92);color:#0a2540;border:1px solid rgba(10,37,64,.12);padding:15px 34px;box-shadow:0 8px 24px rgba(10,37,64,.06)}
.back[hidden]{visibility:hidden}
.cont{background:#1f74c4;color:#fff;padding:16px 42px;box-shadow:0 12px 30px rgba(10,37,64,.22)}
.cont[hidden]{display:none}
.cont:active,.back:active{transform:translateY(1px)}
</style></head><body>
<div id="stagebox">
<div id="bglayer"><div class="aurora" id="orbPink"></div><div class="aurora" id="orbBlue"></div><div class="grain"></div></div>
<iframe id="frame"></iframe>
<div id="navlayer">
<img id="logomark" src="keepance-logo.svg" alt="Keepance"/>
<div class="scrim"></div>
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
for(let k=0;k<scenes.length-1;k++){const d=document.createElement('button');d.className='dot';d.title='Step '+(k+1);d.onclick=()=>show(k+1);dotsWrap.appendChild(d);}
const dots=[...dotsWrap.children];
function show(n){i=(n+scenes.length)%scenes.length;frame.src=scenes[i].file;back.hidden=i===0;cont.hidden=i===0;cont.innerHTML=scenes[i].cont;logomark.classList.toggle('show',i!==0);dotsWrap.style.display=i===0?'none':'flex';dots.forEach((d,idx)=>{d.classList.toggle('active',idx===i-1);d.classList.toggle('done',idx<i-1);});}
cont.onclick=()=>show(i===scenes.length-1?0:i+1);
back.onclick=()=>show(i-1);
window.addEventListener('message',function(e){if(e.data==='kp-advance')show(i===scenes.length-1?0:i+1);});
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='Enter')show(i===scenes.length-1?0:i+1);if(e.key==='ArrowLeft')show(i-1);});
show(0);
</script></body></html>"""
open(os.path.join(OUT,"index.html"),"w").write(SHELL.replace("__SCENES__",scene_js))
print(f"wrote {len(scenes)} concise scenes (1 intro + 3 action) + shell to {OUT}")
