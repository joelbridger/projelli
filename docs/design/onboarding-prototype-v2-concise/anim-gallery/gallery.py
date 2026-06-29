#!/usr/bin/env python3
# Builds a side-by-side comparison gallery of the sourced Lottie candidates.
# Scans ./lottie/ for cN-x.json (Gallery A, screen-1 MIDDLE icon, concepts 1-7)
# and connect-NN.json (Gallery B, the "connect your AI + files" icon), plus their
# .meta sidecars (one pipe-delimited line: Label|Name by Author|sourceURL|license).
# Run AFTER the sourcing agents finish; writes ./index.html. Serve with:
#   python3 ../serve_nocache.py 8904 .
import os, re, html, json

BASE = os.path.dirname(os.path.abspath(__file__))
LOTTIE = os.path.join(BASE, "lottie")

CONCEPTS = {
    1: "Puzzle assembling", 2: "Coming into focus", 3: "Dots into a portrait",
    4: "Mosaic flip", 5: "Profile building itself", 6: "Person at the center",
    7: "Silhouette filling in",
}

def read_meta(jsonpath):
    meta = jsonpath[:-5] + ".meta"
    if os.path.isfile(meta):
        line = open(meta, encoding="utf-8", errors="replace").read().strip().splitlines()
        if line:
            parts = [p.strip() for p in line[0].split("|")]
            while len(parts) < 4:
                parts.append("")
            return parts[0], parts[1], parts[2], parts[3]
    return "", "", "", ""

def valid_lottie(p):
    try:
        d = json.load(open(p, encoding="utf-8"))
        return isinstance(d, dict) and "v" in d and "layers" in d
    except Exception:
        return False

galleryA = {}   # concept -> list of (file, name, url, license)
galleryB = []   # list of (file, name, url, license)

for fn in sorted(os.listdir(LOTTIE)):
    if not fn.endswith(".json"):
        continue
    full = os.path.join(LOTTIE, fn)
    if not valid_lottie(full):
        continue
    label0, name, url, lic = read_meta(full)
    mA = re.match(r"^c(\d+)-([a-z])\.json$", fn)
    mB = re.match(r"^connect-(\d+)\.json$", fn)
    if mA:
        c = int(mA.group(1))
        galleryA.setdefault(c, []).append((fn, name or fn, url, lic))
    elif mB:
        galleryB.append((fn, name or fn, url, lic))

def lic_badge(lic):
    l = (lic or "").lower()
    if "free" in l or "cc0" in l or "simple" in l:
        cls, txt = "ok", lic or "free"
    elif "attrib" in l:
        cls, txt = "warn", lic
    elif "paid" in l:
        cls, txt = "bad", lic
    else:
        cls, txt = "neutral", (lic or "license?")
    return f'<span class="lic {cls}">{html.escape(txt)}</span>'

def card(file, name, url, lic):
    src = "lottie/" + file
    link = f'<a href="{html.escape(url)}" target="_blank" rel="noopener">source</a>' if url else '<span class="nolink">no url</span>'
    return f"""<div class="card">
  <div class="player" data-src="{html.escape(src)}"></div>
  <div class="meta">
    <div class="name">{html.escape(name)}</div>
    <div class="sub"><span class="file">{html.escape(file)}</span> · {link} · {lic_badge(lic)}</div>
  </div>
</div>"""

secA = []
for c in range(1, 8):
    items = galleryA.get(c, [])
    head = f'<h3>#{c} &middot; {html.escape(CONCEPTS[c])} <span class="count">{len(items)} match{"es" if len(items)!=1 else ""}</span></h3>'
    if items:
        body = '<div class="grid">' + "".join(card(*it) for it in items) + "</div>"
    elif c == 6:
        body = ('<div class="none">Still sourcing. A clean, free, on-brand match is proving hard: '
                'the realistic free results are colorful character scenes (off-brand) or paid/dark. '
                'I can grab a specific near-miss (e.g. a colorful "person + floating documents" scene, '
                'or an abstract monochrome orbit with no literal person) if you accept that trade-off, '
                'or this one likely needs a custom-commissioned animation.</div>')
    else:
        body = '<div class="none">No good real Lottie match found for this concept.</div>'
    secA.append(head + body)

secB = '<div class="grid">' + "".join(card(*it) for it in galleryB) + "</div>" if galleryB else '<div class="none">No candidates yet.</div>'

DOC = """<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Keepance onboarding — animation options</title>
<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f6fb;color:#0a2540;font-family:'Sora',system-ui,-apple-system,sans-serif;padding:40px 48px 80px}
h1{font-size:32px;font-weight:800;letter-spacing:-.5px;margin-bottom:6px}
.lead{font-size:17px;color:#5b6b80;margin-bottom:8px;max-width:900px;line-height:1.5}
.bar{height:4px;width:120px;border-radius:99px;background:#1f74c4;margin:18px 0 34px}
h2{font-size:24px;font-weight:800;margin:46px 0 6px;border-top:1px solid rgba(10,37,64,.1);padding-top:30px}
.h2sub{font-size:15px;color:#5b6b80;margin-bottom:20px}
h3{font-size:18px;font-weight:700;margin:26px 0 14px;display:flex;align-items:center;gap:10px}
.count{font-size:13px;font-weight:700;color:#8a93a3;background:#eef1f7;border-radius:99px;padding:4px 11px}
.grid{display:flex;flex-wrap:wrap;gap:22px}
.card{background:#fff;border:1px solid rgba(10,37,64,.09);border-radius:18px;box-shadow:0 10px 30px rgba(10,37,64,.06);padding:18px;width:248px}
.player{width:212px;height:212px;margin:0 auto 14px;background:#fbfcfe;border:1px solid rgba(10,37,64,.06);border-radius:12px;display:flex;align-items:center;justify-content:center}
.player svg{width:100%!important;height:100%!important}
.name{font-size:15px;font-weight:700;line-height:1.3;margin-bottom:6px}
.sub{font-size:12px;color:#8a93a3;display:flex;flex-wrap:wrap;align-items:center;gap:6px;line-height:1.5}
.sub a{color:#1f74c4;font-weight:700;text-decoration:none}
.sub a:hover{text-decoration:underline}
.file{color:#aab2c0}
.lic{font-weight:700;border-radius:6px;padding:2px 8px;font-size:11px}
.lic.ok{background:#e3f4ea;color:#1d7a44}
.lic.warn{background:#fdf2dd;color:#9a6a12}
.lic.bad{background:#fbe4e4;color:#a32020}
.lic.neutral{background:#eef1f7;color:#5b6b80}
.none{font-size:15px;color:#9aa4b4;font-style:italic;padding:8px 0 4px}
.nolink{color:#aab2c0}
.legend{font-size:13px;color:#8a93a3;margin-top:10px}
</style></head><body>
<h1>Keepance onboarding — animation options</h1>
<div class="lead">Real Lottie animations sourced from LottieFiles for the two screen-1 icons Jameson wants to replace. Pick one from each section; we wire the winner in. Every candidate links to its source and shows its license.</div>
<div class="bar"></div>
<h2>Gallery A &middot; the MIDDLE icon (scattered client data becomes one clear picture)</h2>
<div class="h2sub">7 concepts; the 1-2 best real matches found for each. This replaces the rejected pin/map.</div>
__SECA__
<h2>Gallery B &middot; the "Connect your AI and files" icon</h2>
<div class="h2sub">Connect / link / plug-in / integrate candidates. This replaces the rejected chain-link.</div>
__SECB__
<div class="legend">License key: <span class="lic ok">free</span> commercial-OK &nbsp; <span class="lic warn">needs attribution</span> &nbsp; <span class="lic bad">paid</span></div>
<script>
  document.querySelectorAll('.player').forEach(function(el){
    try{ lottie.loadAnimation({container:el,renderer:'svg',loop:true,autoplay:true,path:el.getAttribute('data-src')}); }catch(e){}
  });
</script>
</body></html>"""

out = DOC.replace("__SECA__", "\n".join(secA)).replace("__SECB__", secB)
open(os.path.join(BASE, "index.html"), "w", encoding="utf-8").write(out)
nA = sum(len(v) for v in galleryA.values())
print(f"gallery built: A={nA} files across {len([c for c in galleryA if galleryA[c]])} concepts, B={len(galleryB)} files")
