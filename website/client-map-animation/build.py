#!/usr/bin/env python3
# Concept 6 (v2): constellation of sources -> light, feature-rich Client Map dossier
# with self-expanding sections, gap notes, edit/add/delete affordances, and a search finale.
import os
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

ICONS = {
 "people": '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
 "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
 "target": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
 "alert": '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
 "building": '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
 "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
 "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
 "note": '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
 "mic": '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
 "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
 "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
 "clipboard": '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
 "folder": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
 "check": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
 "pencil": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
 "x": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
 "plus": '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
 "search": '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
}
def ic(n): return '<svg viewBox="0 0 24 24" aria-hidden="true">%s</svg>' % ICONS[n]

CX, CY = 50.0, 42.0
VW, VH = 1000, 780
def vx(p): return p/100*VW
def vy(p): return p/100*VH

SOURCES = [
 ("mail","Email",15,18),("file","Statements",36,10),("note","Meeting notes",60,12),
 ("folder","Financial plan",83,20),("clipboard","KYC form",90,44),("alert","Risk profile",78,70),
 ("phone","Calls",55,80),("calendar","Calendar",30,76),("check","Beneficiary forms",11,46),
]
N = len(SOURCES)

# radial connector per source (thick), plus faint ring links between neighbours
web=""
for i,(_,_,x,y) in enumerate(SOURCES):
    web += f'<line class="cw rad" id="rad{i}" x1="{vx(x):.0f}" y1="{vy(y):.0f}" x2="{vx(CX):.0f}" y2="{vy(CY):.0f}"/>'
for i in range(N):
    a=SOURCES[i]; b=SOURCES[(i+1)%N]
    web += f'<line class="cw ring" x1="{vx(a[2]):.0f}" y1="{vy(a[3]):.0f}" x2="{vx(b[2]):.0f}" y2="{vy(b[3]):.0f}"/>'

srcnodes=""
for i,(name,lbl,x,y) in enumerate(SOURCES):
    srcnodes += f'<div class="src" id="src{i}" style="left:{x}%;top:{y}%"><div class="sdot">{ic(name)}</div><span class="slbl">{lbl}</span></div>'

stars_pts=[(120,80),(300,55),(470,110),(640,60),(820,100),(910,240),(70,300),(250,360),
           (520,330),(760,380),(880,520),(160,560),(360,640),(560,610),(700,560),(440,470),
           (130,180),(680,180),(940,420),(40,470),(300,720),(620,720)]
stars="".join(f'<circle class="star" cx="{x}" cy="{y}" r="2.6"/>' for x,y in stars_pts)

# ---- dossier sections: (icon, title, fieldcount, [ (label,value,source|None) x3 ], more_n, gap|None) ----
SECTIONS = [
 ("people","Household &amp; key people",8,[("Primary","Allison Smith",None),("Spouse","David Smith","KYC form"),("Children","Emma (14), Noah (11)",None)],5,"Missing: trusted contact form not on file"),
 ("target","Goals &amp; priorities",6,[("Retirement","Target around 2038",None),("College","Fund Emma and Noah","Meeting notes"),("Legacy","Keep home in family",None)],3,None),
 ("building","Accounts &amp; holdings",7,[("401(k)","David, held away",None),("Roth IRAs","Both spouses","Statements"),("529 plans","Two children",None)],4,"Gap: held-away 401(k) not linked yet"),
 ("alert","Risk &amp; suitability",5,[("Risk tolerance","Moderate",None),("Time horizon","12+ years",None),("KYC","On file","KYC form")],2,"Missing: risk profile is over a year old"),
 ("clock","Timeline &amp; next actions",6,[("Client since","2019",None),("Last review","January 2026",None),("Next review","Due Q3","Calendar")],3,None),
]

def field(label,value,src):
    chip = f'<span class="fsrc">{src}</span>' if src else ''
    return (f'<div class="fld"><span class="flbl">{label}</span>'
            f'<span class="fval">{value}</span>{chip}'
            f'<span class="facts"><i class="fa">{ic("pencil")}</i><i class="fa">{ic("x")}</i></span></div>')

secs=""
for name,title,nf,fields,more,gap in SECTIONS:
    body="".join(field(l,v,s) for l,v,s in fields)
    body += f'<div class="more">+{more} more fields</div>'
    if gap:
        body += f'<div class="gap"><span class="gico">{ic("alert")}</span>{gap}</div>'
        flag='<span class="flag review">1 gap</span>'
    else:
        body += f'<div class="ok"><span class="gico">{ic("check")}</span>All key fields captured</div>'
        flag='<span class="flag done">complete</span>'
    body += f'<div class="addf"><i class="fa">{ic("plus")}</i>Add detail</div>'
    secs += (f'<div class="sec" data-sec>'
             f'<div class="sechead"><span class="sci">{ic(name)}</span>'
             f'<div class="stitle">{title}</div>'
             f'<span class="fcount">{nf} fields</span>{flag}'
             f'<span class="chev">&#9662;</span></div>'
             f'<div class="subs">{body}</div></div>')

asm = "".join(f'<div class="arow"><span class="aic">{ic(name)}</span><span class="albl">{lbl}</span><span class="adot">{ic("check")}</span></div>' for name,lbl,x,y in SOURCES)
ASSEMBLY = '<div class="acap">From your sources</div>'+asm

QUESTION="What's still open before the Smith review?"

HTML = r"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>6 &middot; Constellation to Client Map</title>
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@800,700,600,500,400&display=swap" rel="stylesheet">
<style>
:root{--navy:#0A2540;--pink:#FF3CE8;--blue:#5DC6FF;
 --ink:#0A2540;--ink2:#51627A;--ink3:#8694A8;--line:#E7ECF3;--soft:#F4F7FB;--card:#FFFFFF;}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:radial-gradient(120% 90% at 50% 0,#0d2c4a,#0A2540 62%);font-family:'Satoshi',system-ui,sans-serif;color:#fff;overflow:hidden}
.wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:26px}
.stage{position:relative;width:100%;max-width:1060px;aspect-ratio:1000/780}
svg.web{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:2}
.cw{stroke:url(#cwg)}
.rad{stroke-width:2.8;opacity:0;stroke-linecap:round}
.ring{stroke-width:1.8;opacity:0;stroke-dasharray:2 9;stroke-linecap:round}
.star{fill:#bfe0ff;opacity:0}
.ig{display:flex;align-items:center;justify-content:center;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--blue))}
.ig svg{stroke:#fff;fill:none;stroke-width:2}
/* ---- source constellation ---- */
.src{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;visibility:hidden;z-index:3}
.sdot{width:66px;height:66px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(13,40,68,.95);border:2px solid rgba(93,198,255,.55);box-shadow:0 0 28px rgba(93,198,255,.3)}
.sdot svg{width:31px;height:31px;stroke:var(--blue);fill:none;stroke-width:2}
.slbl{font-size:15px;font-weight:600;color:#cfe0f2;white-space:nowrap}
/* ---- forming seam of light ---- */
.seam{position:absolute;left:50%;top:50%;width:min(660px,94%);height:5px;transform:translate(-50%,-50%);border-radius:5px;
 background:linear-gradient(90deg,rgba(255,60,232,0),#FF3CE8,#5DC6FF,rgba(93,198,255,0));
 box-shadow:0 0 50px 8px rgba(93,198,255,.6);opacity:0}
/* ---- light dossier (the app) ---- */
.card{position:absolute;left:50%;top:50%;width:min(680px,95%);height:658px;z-index:1;
 background:var(--card);border-radius:18px;border:1px solid var(--line);
 box-shadow:0 40px 90px rgba(3,18,38,.55);display:flex;flex-direction:column;overflow:hidden;visibility:hidden}
.cardInner{display:flex;flex-direction:column;height:100%;color:var(--ink)}
.dhead{display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:1px solid var(--line);flex-shrink:0}
.av{width:50px;height:50px;border-radius:50%;background:#0A2540;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#fff;flex-shrink:0;letter-spacing:.02em}
.dh{flex:1;min-width:0}
.dname{font-size:19px;font-weight:700;color:var(--ink)}
.dmeta{font-size:12.5px;color:var(--ink3);font-weight:500;margin-top:2px}
.dmeta b{color:var(--blue);font-weight:700;letter-spacing:.04em}
.dpct{text-align:right;flex-shrink:0}
.dpct b{font-size:24px;font-weight:800;background:linear-gradient(135deg,var(--pink),var(--blue));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.dpct small{display:block;font-size:10px;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;margin-top:1px}
.secwrap{flex:1;overflow:hidden;padding:6px 14px;position:relative}
.assembly{position:absolute;inset:0;padding:12px 16px;display:flex;flex-direction:column;justify-content:center;gap:1px}
.acap{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);padding:0 12px 10px}
.arow{display:flex;align-items:center;gap:13px;padding:9px 12px;border-bottom:1px solid var(--line)}
.arow:last-child{border-bottom:none}
.aic{width:30px;height:30px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.aic svg{width:21px;height:21px;stroke:#0A2540;fill:none;stroke-width:2}
.albl{flex:1;font-size:15px;font-weight:600;color:var(--ink)}
.adot{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.adot svg{width:16px;height:16px;stroke:#0E9F6E;fill:none;stroke-width:2.4}
.sec{border-radius:11px;border-bottom:1px solid var(--line)}
.sec:last-child{border-bottom:none}
.sechead{display:flex;align-items:center;gap:12px;padding:11px 10px}
.sci{width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center}.sci svg{width:22px;height:22px;stroke:#0A2540;fill:none;stroke-width:2}
.stitle{flex:1;font-size:15.5px;font-weight:700;color:var(--ink)}
.fcount{font-size:11.5px;color:var(--ink3);font-weight:600;background:var(--soft);padding:2px 9px;border-radius:20px}
.flag{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;letter-spacing:.01em}
.flag.review{color:#B5179E;background:#FDECF7;border:1px solid #F4C6E6}
.flag.done{color:#0E9F6E;background:#E9FAF2;border:1px solid #C4ECDB}
.chev{color:var(--ink3);font-size:11px;width:13px;text-align:center}
.subs{height:0;overflow:hidden}
.fld{display:flex;align-items:center;gap:10px;padding:7px 10px 7px 52px;border-radius:8px;position:relative}
.fld:hover{background:var(--soft)}
.fld::before{content:"";position:absolute;left:38px;top:15px;width:5px;height:5px;border-radius:50%;background:var(--blue);opacity:.7}
.flbl{font-size:13.5px;color:var(--ink3);font-weight:600;min-width:108px}
.fval{font-size:14px;color:var(--ink);font-weight:600;flex:1}
.fsrc{font-size:11px;color:var(--ink2);background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-weight:600}
.facts{display:flex;gap:6px;opacity:.55}
.fa{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--soft)}
.fa svg{width:13px;height:13px;stroke:var(--ink3);fill:none;stroke-width:2}
.more{font-size:12.5px;color:var(--blue);font-weight:600;padding:6px 0 6px 52px;cursor:pointer}
.addf{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink3);font-weight:600;padding:7px 0 9px 46px}
.addf .fa{background:transparent;border:1px dashed var(--line);width:22px;height:22px}
.gap,.ok{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:6px 0 6px 46px;padding:8px 12px;border-radius:9px}
.gap{color:#B5179E;background:#FDECF7;border:1px solid #F4C6E6}
.ok{color:#0E9F6E;background:#E9FAF2;border:1px solid #C4ECDB}
.gico{width:17px;height:17px;flex-shrink:0}.gico svg{width:17px;height:17px;fill:none;stroke-width:2.2}
.gap .gico svg{stroke:#E255B5}.ok .gico svg{stroke:#13B981}
/* ---- search bar ---- */
.searchbar{flex-shrink:0;margin:12px 16px 16px;display:flex;align-items:center;gap:11px;background:var(--soft);border:1.5px solid var(--line);border-radius:12px;padding:13px 16px;visibility:hidden}
.sb-ic{width:19px;height:19px;flex-shrink:0}.sb-ic svg{width:19px;height:19px;stroke:var(--blue);fill:none;stroke-width:2.2}
.sb-q{font-size:14.5px;color:var(--ink);font-weight:500;white-space:nowrap;overflow:hidden}
.sb-cursor{display:inline-block;width:2px;height:17px;background:var(--blue);margin-left:1px;vertical-align:-3px}
.sb-ph{color:var(--ink3);font-weight:500}
.thinking{display:flex;gap:4px;margin-left:auto;visibility:hidden}
.thinking i{width:6px;height:6px;border-radius:50%;background:var(--blue)}
/* ---- answer popover ---- */
.answer{position:absolute;left:16px;right:16px;bottom:14px;background:#fff;border:1px solid var(--line);border-radius:13px;
 box-shadow:0 20px 50px rgba(3,18,38,.22);padding:16px 18px 16px 20px;visibility:hidden}
.answer::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:4px;border-radius:4px;background:linear-gradient(var(--pink),var(--blue))}
.ans-h{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--blue);margin-bottom:6px}
.ans-t{font-size:14.5px;line-height:1.5;color:var(--ink);font-weight:500}
.ans-chips{display:flex;gap:7px;margin-top:11px}
.ans-chip{font-size:11.5px;font-weight:700;color:var(--ink2);background:var(--soft);border:1px solid var(--line);border-radius:7px;padding:3px 9px;display:flex;align-items:center;gap:5px}
.ans-chip b{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,var(--pink),var(--blue))}
</style></head><body>
<div class="wrap"><div class="stage" id="stage">
<svg class="web" viewBox="0 0 1000 780" preserveAspectRatio="none">
<defs><linearGradient id="cwg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="780"><stop offset="0" stop-color="#FF3CE8"/><stop offset="1" stop-color="#5DC6FF"/></linearGradient></defs>
%%STARS%%%%WEB%%</svg>
%%SOURCES%%
<div class="seam" data-seam></div>
<div class="card" data-card><div class="cardInner">
 <div class="dhead"><div class="av">AS</div>
  <div class="dh"><div class="dname">Smith household</div><div class="dmeta"><b>CLIENT MAP</b> &middot; 5 sections &middot; 32 fields</div></div>
  <div class="dpct"><b><span id="dpct">0</span>%</b><small>context</small></div></div>
 <div class="secwrap">%%SECTIONS%%
  <div class="assembly" data-asm>%%ASSEMBLY%%</div>
  <div class="answer" data-answer>
   <div class="ans-h">Answer</div>
   <div class="ans-t">Three things to handle before the review: the risk profile is over a year old, the held-away 401(k) is not linked yet, and the trusted contact form is missing.</div>
   <div class="ans-chips"><span class="ans-chip"><b></b>Risk</span><span class="ans-chip"><b></b>Accounts</span><span class="ans-chip"><b></b>Household</span></div>
  </div>
 </div>
 <div class="searchbar"><span class="sb-ic">%%SEARCHICON%%</span><span class="sb-q" id="qel"></span><span class="sb-cursor" id="cur"></span><span class="thinking" data-think><i></i><i></i><i></i></span></div>
</div></div>
</div></div>
<script src="gsap.min.js"></script>
<script>
var CX="%%CX%%%",CY="%%CY%%%",NSRC=%%NSRC%%,QUESTION="%%QUESTION%%";
function run(){ if(!window.gsap){return} var g=window.gsap;
 var pct=document.getElementById('dpct'),qel=document.getElementById('qel'),cur=document.getElementById('cur');
 g.set('.star',{opacity:0}); g.set('.cw',{opacity:0});
 g.set('.src',{autoAlpha:0,scale:.4});
 g.set('.seam',{scaleX:0,opacity:0,transformOrigin:'50% 50%'});
 g.set('.card',{autoAlpha:0,xPercent:-50,yPercent:-50,transformOrigin:'50% 50%'});
 g.set('.cardInner',{autoAlpha:0});
 g.set('.sec',{autoAlpha:0,y:8});
 g.set('.subs',{height:0});
 g.set('.searchbar',{autoAlpha:0,y:10});
 g.set('.answer',{autoAlpha:0,y:14});
 g.set('#cur',{opacity:1});
 g.set('.assembly',{autoAlpha:0});
 g.set('.arow',{autoAlpha:0,x:-14});

 var tl=g.timeline();
 tl.to('.star',{opacity:.6,duration:1,stagger:{each:.04,from:'random'}},0);
 // sources appear ONE AT A TIME, slower; each radial line draws in with it
 var step=0.42, t0=0.5;
 for(var i=0;i<NSRC;i++){
   var t=t0+i*step;
   tl.to('#src'+i,{autoAlpha:1,scale:1,duration:.55,ease:'back.out(1.5)'},t);
   tl.to('#rad'+i,{opacity:.55,duration:.5},t+.05);
 }
 var tRing=t0+NSRC*step;
 tl.to('.ring',{opacity:.32,duration:.7,stagger:.04},tRing);
 // ---- TRANSFORM ----
 // 1) the dossier fades in BEHIND the still-visible web of sources (card sits behind via z-index)
 var tReveal=tRing+0.9;
 tl.to('.card',{autoAlpha:1,duration:.8,ease:'power2.out'},tReveal)
   .to('.cardInner',{autoAlpha:1,duration:.6,ease:'power2.out'},tReveal+.15);
 // 2) the web clears and the source icons fly into the file, lining up as a list
 var tGather=tReveal+1.05;
 tl.to('.slbl',{autoAlpha:0,duration:.3},tGather)
   .to('.cw',{opacity:0,duration:.55,ease:'power2.in'},tGather)
   .to('.star',{opacity:.16,duration:.8},tGather)
   .to('.assembly',{autoAlpha:1,duration:.3},tGather+.1)
   .to('.src',{left:CX,top:CY,scale:.18,autoAlpha:0,duration:.85,ease:'power2.inOut',stagger:{each:.06,from:'start'}},tGather+.15)
   .to('.arow',{autoAlpha:1,x:0,duration:.42,stagger:.09,ease:'power2.out'},tGather+.45);
 // 3) the list dissolves and reorganizes into the structured dossier
 var tForm=tGather+2.4;
 tl.to('.arow',{autoAlpha:0,y:-12,duration:.45,stagger:.05,ease:'power2.in'},tForm)
   .to('.assembly',{autoAlpha:0,duration:.3},tForm+.6)
   .to('.sec',{autoAlpha:1,y:0,duration:.45,stagger:.09,ease:'power2.out'},tForm+.4)
   .to('.searchbar',{autoAlpha:1,y:0,duration:.5,ease:'power2.out'},tForm+.8);
 var o={v:0};
 tl.to(o,{v:85,duration:1.3,ease:'power2.out',onUpdate:function(){pct.textContent=Math.round(o.v)}},tForm+.5);

 // ambient star twinkle
 g.to('.star',{opacity:.12,duration:2.4,ease:'sine.inOut',repeat:-1,yoyo:true,stagger:{each:.25,from:'random'}});

 tl.add(buildBody(),'+=0.5');

 function expandClose(idx){
   var secEls=g.utils.toArray('.sec');
   var sec=secEls[idx],subs=sec.querySelector('.subs'),chev=sec.querySelector('.chev');
   var t=g.timeline();
   t.to(sec,{backgroundColor:'#F4F7FB',duration:.3})
    .to(chev,{rotate:180,duration:.4,transformOrigin:'50% 50%'},'<')
    .to(subs,{height:'auto',duration:.55,ease:'power2.out'},'<')
    .to({},{duration:1.9})
    .to(sec,{backgroundColor:'rgba(255,255,255,0)',duration:.4})
    .to(chev,{rotate:0,duration:.4},'<')
    .to(subs,{height:0,duration:.45,ease:'power2.in'},'<');
   return t;
 }
 function searchDemo(){
   var t=g.timeline();
   var p={i:0};
   t.add(function(){qel.textContent='';g.set('#cur',{opacity:1});})
    .to({},{duration:.4})
    .to(p,{i:QUESTION.length,duration:.05*QUESTION.length,ease:'none',
        onUpdate:function(){qel.textContent=QUESTION.slice(0,Math.round(p.i));}})
    .to('#cur',{opacity:0,duration:.2})
    .set('.thinking',{visibility:'visible'})
    .to('.thinking i',{y:-5,duration:.32,repeat:5,yoyo:true,stagger:.12,ease:'sine.inOut'})
    .set('.thinking',{visibility:'hidden'})
    .to('.answer',{autoAlpha:1,y:0,duration:.5,ease:'power3.out'},'+=0.05')
    .from('.ans-chip',{autoAlpha:0,y:6,scale:.9,stagger:.1,duration:.3},'<0.15')
    .to({},{duration:3.0})
    .to('.answer',{autoAlpha:0,y:14,duration:.45})
    .add(function(){qel.textContent='';});
   return t;
 }
 function buildBody(){
   var b=g.timeline({repeat:-1});
   b.add(expandClose(0));   // People (gap)
   b.add(expandClose(3));   // Risks (gap)
   b.add(expandClose(2));   // Goals (gap)
   b.add(searchDemo());     // ask + answer finale
   b.to({},{duration:1.0});
   return b;
 }
 // headless safety net -> settle on the dossier (only fires after the intro would finish;
 // in a live browser the animation completes first, so this is a no-op there)
 setTimeout(function(){try{
   g.set('.src',{autoAlpha:0});g.set('.seam',{opacity:0});g.set('.cw',{opacity:0});
   g.set('.assembly',{autoAlpha:0});g.set('.arow',{autoAlpha:0});
   g.set('.card',{autoAlpha:1,scaleX:1,scaleY:1});g.set('.cardInner',{autoAlpha:1});
   g.set('.sec',{autoAlpha:1,y:0});g.set('.searchbar',{autoAlpha:1,y:0});pct.textContent='85';
 }catch(e){}},13000);
}
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run)}else{addEventListener('load',run)}
</script></body></html>"""

HTML = (HTML.replace("%%STARS%%",stars).replace("%%WEB%%",web)
            .replace("%%SOURCES%%",srcnodes).replace("%%SECTIONS%%",secs)
            .replace("%%SEARCHICON%%",ic("search"))
            .replace("%%CX%%",str(CX)).replace("%%CY%%",str(CY))
            .replace("%%NSRC%%",str(N)).replace("%%QUESTION%%",QUESTION)
            .replace("%%ASSEMBLY%%",ASSEMBLY))

open(os.path.join(OUT,"index.html"),"w").write(HTML)
print("wrote", os.path.join(OUT,"index.html"), len(HTML), "bytes")
