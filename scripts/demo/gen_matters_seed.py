import json, os, re

CLIENTS_DIR = "output/Northcrest Wealth Partners/Clients"
WIN_ROOT = "C:/keepance-demo-northcrest/Northcrest Wealth Partners"
DEEP = {"Hollings Family","Ellison, Robert & Margaret","Webb, Marcus & Tanya",
        "Voss, Eleanor","Nakamura, David & Susan","Patel, Priya"}
STAR = "Hollings Family"

def slug(s):
    return re.sub(r'[^a-z0-9]+','_', s.lower()).strip('_')

households = sorted(os.listdir(CLIENTS_DIR))
matters = []
for h in households:
    if not os.path.isdir(os.path.join(CLIENTS_DIR, h)):
        continue
    files = sum(len(fs) for _,_,fs in os.walk(os.path.join(CLIENTS_DIR,h)))
    matters.append({
        "id": f"matter_nc_{slug(h)}",
        "name": h,
        "client": h,
        "folderPaths": [f"{WIN_ROOT}/Clients/{h}"],
        "mailFolderPaths": [],
        "privileged": False,
        "mcpAccessGranted": False,
        "createdAt": "2026-06-24T00:00:00.000Z",
        "_files": files,
        "_deep": h in DEEP,
        "_star": h == STAR,
    })

print(f"{len(matters)} clients")
for m in matters:
    tag = "STAR" if m["_star"] else ("deep" if m["_deep"] else "    ")
    print(f"  [{tag}] {m['_files']:>2} files  {m['name']}")

# Strip the underscore-prefixed helper fields for the actual seed
clean = [{k:v for k,v in m.items() if not k.startswith('_')} for m in matters]
out = "/tmp/claude-1000/-home-jameson/2d6974ec-1daa-42c9-bb37-94ef8737c615/scratchpad/northcrest_matters.json"
with open(out,"w") as f:
    json.dump(clean, f, indent=2)
print(f"\nWrote {out}")
