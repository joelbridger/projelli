# UI Simplification Pass — clean up text everywhere (Jameson, 2026-07-05)

**Timing: do the CODE work AFTER the demo is proven** (a broad cross-app change would destabilize the demo + invalidate the running demo test). Safe read-only prep/audit can start in parallel now. This is a post-demo polish phase Jameson already knows he wants ("even when the demo works, I'll want a UI pass").

## The principle
The app must look **extremely clean, intuitive, and easy**. A user should usually understand a section just from its **title (+ icon)**. Today there's too much **gray explanatory subtext** (whole paragraphs) sitting under things by default — Jameson does NOT want any of that gray sub-text showing by default anywhere.

## The rules
1. **Remove gray explanatory subtext everywhere by default.** No paragraphs of gray helper text under cards/sections/settings.
2. **Replace it with a small hover info icon ("i").** The explanation moves INTO a tooltip you get by hovering the little "i" next to the title. Nothing shows until you hover.
   - Need a reusable **InfoIcon / hover-tooltip primitive** (check `src/ui/` for an existing one before building — likely a Radix tooltip already exists). Use it consistently everywhere.
3. **Named example (not the only place — it's everywhere):** Settings → **AI and Privacy** tab → the account cards "On This Computer Only" and "Cloud AI" each have a large paragraph of gray text → move that text behind an "i" hover.
4. **Left-hand CLIENT LIST — two changes (no info icon here):**
   a. It repeats each client's **name underneath in light-gray subtext**, which adds no value → **remove that repeated subtext entirely**; clean up the client rows.
   b. The client list **fills up the whole left bar** → make it **auto-collapse into its own section** (a collapsible section, not an always-expanded list hogging the sidebar).

## Audit DONE (2026-07-05) — concrete work-list

**Primitive: mostly exists.** `src/ui/tooltip.tsx` is a Radix tooltip wrapper (`@radix-ui/react-tooltip` installed), already used (ChatCostChip, AIContextIndicator, DocxDocumentView). → Just build a small **`InfoHelp`** wrapper = an "i" icon + this existing tooltip. Tiny.

**Gray-subtext inventory (a repeating pattern — mechanical once InfoHelp exists):** the common shape is `<p className="text-xs text-muted-foreground ...">{description}</p>` → replace with `<InfoHelp content={description} />` next to the title. Locations found:
- **Settings** — incl. AI & Privacy cards ("On This Computer Only", "Cloud AI").
- **Onboarding** — ChooseStartScene (73/94/129), AiScene (359/451), ConnectScene (95/96), ApiKeySetupCard (111/131), ApiKeyWizard (634).
- **Connectors** — MailConnect:115, CalendarConnect:254, OneDriveConnect:299, WealthboxConnect:391 — **and the same card-description pattern repeats across Gmail, IMAP, Salesforce, Redtail, Calendly, Box, ShareFile, Addepar, DocuSign, Jotform, Zocks** (~dozens of spots, one pattern).
- **Rule:** keep WARNING/STATUS text visible (something is wrong/in-progress); only hide the passive *explanatory* gray text behind the "i".

**Client list — precise (one file: `src/app/shell/layout/Spine.tsx`):**
- Rows render ~line 166; main name line 177 (`matterLabel(m)`); **the redundant repeated light-gray name = line 178 (`m.client`) → DELETE it** (matterLabel already often includes the name).
- Layout: 212px sidebar; the list takes remaining height (`flex:1; overflowY:auto`). **Make it collapsible/auto-collapsing:** wrap in a `<section>` with a "Clients" toggle button + conditional render (audit gives the exact diff). Do it in `Spine` (no separate component exists; extract `ClientSwitcherSection` only if it grows).

## Execution plan (AFTER demo proven)
1. Land the InfoIcon/tooltip primitive (or confirm the existing one).
2. Sweep the audited locations: for each, delete the gray paragraph, add an "i" with the text as its hover tooltip. Consistent placement (next to the title).
3. Client list: delete repeated-name subtext; make the list a collapsible auto-collapsing section.
4. LIGHT theme, match existing design system. Gate each batch (tsc + vitest + eslint). Independent review. Screenshots on real Windows so Jameson can eyeball the cleaner look.
