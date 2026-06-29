# Lottie icon sources & licenses

Three animated Lottie icons for the onboarding flowchart, one per step.
All three are from LottieFiles' free library under the **Lottie Simple License**
(free to use, including commercially; you may not resell/redistribute the file
as a standalone product; do not imply endorsement). Downloaded 2026-06-26.

Each file was extracted from the source `.lottie` (a zip container) and saved as
raw Lottie JSON. All validated as Lottie (`"v"` + `"layers"` present).

---

## step1.json — "Connect your AI and files"

- **Concept:** connect / link (monochrome thin-line chain link, animates the two link halves joining)
- **Title:** "Url Link" (Free Url Link Animation)
- **Author:** Sebastián Nieto
- **Source page:** https://lottiefiles.com/free-animation/url-link-6M8WgxIJZ8
- **Direct file downloaded:** https://assets-v2.lottiefiles.com/a/a7af5892-1167-11ee-a6b4-f3089814d75b/E5agDqVtox.lottie
- **License:** Lottie Simple License (LottieFiles "Free to use") — no attribution legally required; crediting the author is courteous.
- **Saved JSON size:** 9,291 bytes — Lottie v5.5.7, 8 layers — VALID

## step2.json — "Keepance builds Client Maps"

- **Concept:** map / location (a clean deep-navy location pin that bounces — a focal location/map marker, same compact icon family as the chain-link and magnifier)
- **Title:** "Location Pin" (Free Location Pin Animation) — page description: "Location pin animation for use on maps"
- **Author:** Ramees A
- **Source page:** https://lottiefiles.com/free-animation/location-pin-FntjGFdBJ1
- **Direct file downloaded:** https://assets-v2.lottiefiles.com/a/c8cab604-116f-11ee-bc5a-7b17f25f57bf/oz2Iylrz2U.lottie
- **License:** Lottie Simple License (LottieFiles "Free to use") — no attribution legally required; crediting the author is courteous.
- **Saved JSON size:** 4,584 bytes — Lottie v5.5.7, 3 layers — VALID
- **Color:** deep navy (matches brand primary #0A2540); pairs with the gray line chain-link (step1) and blue magnifier (step3).
- **Why this one:** replaces the earlier "Technology Network" globe/sphere, which read as a spinning 3D globe and didn't match the flat, compact, calm icon style of the other two. This navy pin is simple, flat, focal, light, on-brand, and clearly a location/map concept.
- **Alternatives considered (all Lottie Simple License) if you want a different map read:**
  - Flat thin-LINE world-map outline with pings (truest "line" + literal map, but 143 KB and a wide edge-to-edge scene rather than a focal icon): https://lottiefiles.com/free-animation/world-map-pinging-and-searching-3eYNFT0J8S (by Artyom Konakov)
  - Thin-line outline pin (closely matches the line stroke of the chain-link) but has an off-brand red inner ring: https://lottiefiles.com/free-animation/location-pin-EwtWLIEoJc (by Mildred Lo)

## step3.json — "Ask anything, with sources"

- **Concept:** search / ask with AI over a source (blue magnifier + AI sparkle hovering over a result/source card)
- **Title:** "search imm" (Free search imm Animation)
- **Author:** Baback Jafari
- **Source page:** https://lottiefiles.com/free-animation/search-imm-xZN2Dotxbr
- **Direct file downloaded:** https://assets-v2.lottiefiles.com/a/a4fc2fc6-1171-11ee-b9c9-534c870c33fc/RpEAGt75bG.lottie
- **License:** Lottie Simple License (LottieFiles "Free to use").
- **Saved JSON size:** 19,378 bytes — Lottie v5.5.7, 7 layers — VALID
- **Alt considered:** "Searching" by Faaiza (navy magnifier examining a spread of documents, more literal "with sources", 4.9 KB): https://lottiefiles.com/free-animation/searching-4qnihLJD2p — also Lottie Simple License, if you prefer a multi-document look.

---

### Validate command (re-runnable)

```bash
for F in step1.json step2.json step3.json; do
  python3 -c "import json; d=json.load(open('$F')); assert 'v' in d and 'layers' in d; print('OK', '$F', len(open('$F').read()), 'bytes')"
done
```
