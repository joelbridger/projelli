# Rive Guide — Creating the Keepance Onboarding Animations

A practical, Keepance-specific guide for Jameson (product designer) to create the
onboarding animations in Rive. Written 2026-06-21.

## 0. How your work and mine fit together
- **You make the visuals + motion** in Rive: one small file per screen.
- **I build everything else**: the screen-to-screen flow, the smooth transitions,
  the clickable choices, and the wiring to the real setup (saving keys, connecting
  email). Your exported files drop into slots I prepare.
- **The on-screen WORDS stay in my code**, not baked into the animations — so they're
  easy to edit and translate, with no risk of a typo living inside a Rive file. You
  animate the *pictures*; I place the *text* next to them.
- Because YOU make all of them, they'll automatically share one style. The "amateur
  grab-bag" problem is gone.

## 1. Get set up (~15 min)
- Make a free account at **rive.app**.
- Use the web editor, or download the **Mac/Windows desktop app** (same thing, a bit
  smoother). Either is fine.

## 2. The only 5 Rive concepts you need
Rive can do a lot; ignore most of it at first. You need:
1. **Artboard** — your canvas. One artboard = one scene/screen.
2. **Design mode vs Animate mode** — the toggle at the top. Design = draw/arrange;
   Animate = set keyframes over time.
3. **Timeline** — one animation (keyframes of position/scale/opacity/color over time).
4. **State Machine** — the little "brain" that decides which timeline plays. For the
   first pass it just plays/loops your animation. (Later it can react to the user.)
5. **Inputs / Events** — how an animation talks to the app. Only needed for the
   interactive screens later; skip for now.

## 3. The fast path for you: Figma → Rive
Since you live in Figma:
1. Design the illustration in Figma in the brand colors (below).
2. Select it and **export as SVG**.
3. In Rive: **File → Import** the SVG. It comes in as editable vector shapes/groups
   you can animate. (No re-drawing in Rive.)

You can also draw natively in Rive, but Figma → SVG → Rive will be faster for you.

## 4. The exact specs so your files drop in perfectly
- **Artboard size:** **800 × 600 px** (4:3). It scales cleanly to fit the scene area.
  Keep the key content centered with a little breathing room.
- **Background:** **transparent** (no background fill). Our light page shows through.
- **Brand colors (hex):**
  - Navy (primary): `#0A2540`
  - Sky blue: `#5DC6FF`
  - Pink (accent): `#FF3CE8`
  - Accent gradient: pink → blue (`#FF3CE8` → `#5DC6FF`)
  - Text/dark elements: `#0A2540` on near-white
- **File naming (important — this is how your files map to my slots):** one file per
  screen, named EXACTLY:
  `welcome.riv`, `what-ai-is.riv`, `two-ways.riv`, `choose.riv`, `files-home.riv`,
  `email.riv`, `team.riv`, `done.riv`
- **Inside each file:** name the artboard `Scene`. Leave the state machine at Rive's
  default name (`State Machine 1`) unless I tell you otherwise. One looping or
  play-once timeline as the default.
- **Feel/length:** 2–5 second gentle loops, or a 1–2s play-once that settles into a
  nice resting pose. Subtle and premium — motion that supports the message, not a
  circus.
- **First frame matters:** make frame 1 look good *on its own* (a sensible resting
  pose). For users who turn animations off, that still frame is what they'll see.

## 5. Make your FIRST one — `welcome.riv` (do this one, then we test)
1. New Rive file → set the artboard to 800 × 600, transparent.
2. Import your Figma SVG of the welcome idea (the private workroom: workspace + a
   subtle brain + a lock, per your flow's panel 2).
3. Switch to **Animate** mode. Add a Timeline.
4. Keyframe a gentle entrance: e.g., the workspace fades/scales in, the lock clicks
   shut, a soft settle. Keep it calm (2–4s). Set it to loop or hold on the last frame.
5. Add a **State Machine**, set your timeline as its default state, leave autoplay on.
6. Preview it in Rive (the play button) until the motion feels right.

## 6. Export it
- **File → Export → Download the `.riv` (runtime) file.** (That's the `.riv`, the one
  for apps — NOT the editor/`.rev` project file.) You'll get `welcome.riv`.

## 7. Get it to me + see it live in Keepance (before you make the other 7)
- Get `welcome.riv` onto the server. Easiest: drop it in the same place your
  screenshots go (`~/pastes`). If that only accepts images, tell me and I'll spin up a
  tiny drag-and-drop upload page (couple of minutes).
- I'll wire it into Keepance and show you it rendering in the **real app** — so we
  confirm size, colors, and feel on the very first one. Then you batch the rest with
  confidence.

## 8. The screens you'll animate (mapped to your flow)
| File | Screen (your flow) | Idea to animate |
|---|---|---|
| `welcome.riv` | Welcome | workroom + brain + lock, cool fade-in |
| `what-ai-is.riv` | "Keepance is a private workroom…" | AI helping with files/email; example asks |
| `two-ways.riv` | "AI is new but not scary… two ways" | the two paths: secure provider vs local model |
| `choose.riv` | "Keepance lets you choose either" | the choice moment (provider / local / later) |
| `files-home.riv` | "It's for professionals… privacy" | files staying safe on your computer |
| `email.riv` | "Keepance syncs your email…" | email flowing in, searchable |
| `team.riv` | "Use Keepance with your team" | solo vs team |
| `done.riv` | "You're set" | a clean success/celebration |

(We can split or merge these as your flow firms up — this is a starting map.)

## 9. Interactivity (later, only where it helps)
Most screens just play. A few could *react* to the user — e.g., the "two ways"
diagram highlighting as they read, or the provider choice responding to hover. When
you're comfortable, we add a **State Machine Input** (a Boolean or Trigger) and I drive
it from code. We do this AFTER the basic set looks great; I'll give you the exact input
names to use when we get there.

## 10. Accessibility + reduced motion (I handle, you don't)
- Some users turn animations off; I automatically show a still frame for them. You
  don't do anything — just make frame 1 a good resting pose (see §4).
- I handle keyboard/screen-reader labels in code.

## Resources
- Rive docs + tutorials: **rive.app** → Learn, and **help.rive.app**.
- Rive's official YouTube channel has short beginner tutorials (search "Rive editor
  basics", "Rive state machine").
- Runtime (my side): `@rive-app/react-canvas`.

## The loop, in one line
**Make `welcome.riv` → drop it in `~/pastes` → I show it in Keepance → we tune → you
batch the rest.** Start with just the welcome scene; don't invest hours until we've
confirmed the first one looks perfect in the real app.
