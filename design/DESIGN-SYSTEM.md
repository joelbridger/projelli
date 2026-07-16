# Lantern design system — frozen v2 extraction

## Source determination — resolved, not ambiguous

**The frozen v2 source is** `/home/jameson/lantern/design/fable-v2-lantern/prototypes/fable-v2/index.html`.

Evidence:

1. The design repository’s current history shows `a4c8b3c` — “add Lantern-styled Fable v2 prototype” — followed by `a6f775b`, a small copy correction in that same v2. The earlier `fable-5` exploration has no later competing v2 commit.
2. The design portal’s first, highlighted “Latest — your direction” card links directly to this file and calls it “Fable v2 — Daybook structure + Wealthbox gaps closed + current Lantern visual style.” The older `fable-5` prototypes remain below as the original exploration.
3. The Design track in `MASTER-TRACKER.md` says the portal-pinned v2 was frozen on 2026-07-15 after Jameson approved the latest prototype as the visual and interaction specification.

This document therefore extracts the **rendered, later CSS layer** in that file. The file first declares a warm orange system, then later overrides it with a block explicitly labelled “Current Lantern V1 visual layer.” The later white, navy, and red values win in the browser and are the rules below.

## How to use this

Compare a rendered desktop screenshot to every applicable rule. A screenshot passes only when it satisfies the applicable numbered rules or is intentionally marked as a documented deviation. Rules marked **prototype gap** describe what the frozen prototype does *not* settle; do not invent a “pass” version without a new design decision.

## Tokens

### Colour

| Role | Actual rendered value | Use in the prototype |
|---|---|---|
| Canvas / main background | `#fff` | Main app and panels |
| Quiet surface | `#f3f6fb` | Left rail, quiet cards, field backgrounds, comments |
| Main ink | `#2b2d42` | Headings, strong labels, active states, toast |
| Secondary ink | `rgba(43,45,66,.82)` | Secondary strong copy |
| Muted ink | `rgba(43,45,66,.70)` | Help text, headings, inactive navigation |
| Normal line | `rgba(43,45,66,.16)` | Card, input, modal, and control borders |
| Quiet divider | `rgba(43,45,66,.10)` | List/table separators and rail/top-bar dividers |
| Brand accent | `#ef233c` | Left active marker, selected-tab underline, event edge, important border |
| Accent wash | `rgba(239,35,60,.11)` | Selected navigation, tabs, active scopes, primary button fill |
| Green / positive | `#059669`; text often `#0a5c43` | Verified, delivered, connected, ready |
| Green wash / line | `#e6f5ee` / `#8fc9b0` | Positive tags and proof message |
| Amber / needs attention | `#b45309` | Stale, needs review, assumptions |
| Amber wash / line | `#fbf0e2` / `#e3bf8a` | Attention tags and highlighted content |
| Red / danger | `#b02a1f` | Recording and destructive/danger semantic tag |
| Red wash / line | `#f6e2df` / `rgba(176,42,31,.3)` | Danger tag |
| Blue / information | `#1b5e86` | Informational chips |
| Blue wash / line | `#e1eef6` / `#8fbedb` | Informational chips and avatar example |
| Overlay | `rgba(43,45,66,.18)` | Modal scrim |

### Type, spacing, shape, and elevation

| Token family | Actual rendered values |
|---|---|
| Font | Satoshi (`400`, `500`, `700` supplied); fallback system sans-serif |
| Base copy | `14px/1.45`, normal weight `400` |
| Strong body / controls | `600` most controls; `700` active navigation and main headings |
| Small supporting copy | `11px`, `12px`, `12.5px`, `13px`, `13.5px` |
| Main heading | `22px/1.2`, weight `700` |
| Modal heading | `16px` |
| Section heading | `11px`, weight `600`, uppercase with `.07em` tracking |
| Common gaps | `4`, `6`, `8`, `10`, `12`, `14`, `16`, `18`, `20`, `22`, `24`, `32`, `34px` |
| Page padding | `24px 32px 64px`; main page max width `1420px` |
| Global frame | Top bar `56px`; left rail `220px` |
| Small radius | `4px` (small buttons, tags, calendar events) |
| Control radius | `6px` (buttons, segmented controls, search) |
| Standard radius | `8px` (cards, panels, modal, selected nav) |
| Special radius | `12px` (ask bar); `999px` (pills/citation tokens); `50%` (avatar/help button) |
| Low elevation | `0 1px 2px rgba(43,45,66,.06), 0 1px 3px rgba(43,45,66,.04)` |
| Overlay elevation | `0 16px 40px rgba(43,45,66,.16), 0 4px 12px rgba(43,45,66,.08)` |

## Screenshot-review checklist

### Foundation

- [ ] **DS-1 — Light only.** The whole screen uses a white canvas and light quiet surfaces. No dark-mode counterpart appears in the frozen prototype.
- [ ] **DS-2 — Use the rendered palette.** Main text is navy `#2b2d42`, not black; quiet background is `#f3f6fb`; normal outlines use the navy-alpha lines above.
- [ ] **DS-3 — Reserve bright red `#ef233c` for orientation and emphasis.** It marks selection, key boundaries, small highlights, and event edges. It must not flood ordinary content.
- [ ] **DS-4 — Semantic colour has a job.** Green means ready/verified/delivered; amber means stale, review-needed, or uncertain; red means recording or danger; blue means neutral information.
- [ ] **DS-5 — Do not use brand red to imply a problem by itself.** In this system it is also the brand and selection colour; pair a genuine warning with plain words and, where applicable, amber or danger treatment.
- [ ] **DS-6 — Keep visual contrast quiet.** Most surfaces are white with one thin line and a very small shadow; large gradients, heavy borders, and glossy treatments do not belong.
- [ ] **DS-7 — Use Satoshi where available.** Body copy is 14px/1.45; ordinary strong UI labels use 600; only main titles and selected rail items reach 700.
- [ ] **DS-8 — Keep headings modest.** Main page titles are 22px/700. Section labels are small, uppercase, muted, and tracked rather than large decorative headings.
- [ ] **DS-9 — Work from the existing rhythm.** Default spacing clusters around 8, 12, 14, 16, 20, 24, and 32px. Avoid arbitrary near-values that make adjoining sections look unrelated.
- [ ] **DS-10 — Use the shape ladder.** Tags use 4px or a pill; controls use 6px; cards, panels, and sheets use 8px; the ask entry can use 12px; avatars are circles.
- [ ] **DS-11 — Borders carry most separation.** Use the 16% navy border for a bounded object and the 10% navy divider for rows and chrome. Use the low shadow only for cards/panels; use the larger shadow only above the page.

### Components

- [ ] **DS-12 — Standard card.** A card is white, `1px` normal-line border, `8px` radius, `16px` padding, and low elevation. It groups one clear piece of work, not every small fact.
- [ ] **DS-13 — Quiet nested block.** A small item inside a card uses a divider or `#f3f6fb` quiet surface before a second card. A nested `field-box` has the same border/radius and `12px` padding.
- [ ] **DS-14 — Proposal / judgment card.** An item asking for a decision is white with a red-tinted border (`rgba(239,35,60,.42)`), 8px radius, and a small shadow. It contains a title, plain reason/source line, then Approve / Edit / Reject actions.
- [ ] **DS-15 — Primary action.** The prototype’s primary button is **not solid red**: it is a pale red fill (`rgba(239,35,60,.14)`), red outline, navy text, 32px high, 6px radius, 14px horizontal padding, 13px/600 text.
- [ ] **DS-16 — Secondary action.** A secondary button is white with a normal border, navy text, same 32px height and 6px radius. It becomes a faint navy wash on hover.
- [ ] **DS-17 — Small and ghost actions.** Small buttons are 28px high with 10px side padding and 4px radius. Ghost buttons keep a transparent border/background and muted text; use them for low-emphasis actions, never the only essential path.
- [ ] **DS-18 — Disabled control.** Disabled buttons show `opacity:.45` and do not accept pointer interaction. Do not replace the disabled label with unexplained icon-only treatment.
- [ ] **DS-19 — Input and select.** Form fields are full width, have an `8px 11px` inner pad, white/quiet-surface fill, `1px` normal-line border, 8px radius, and a short 12px/650 label above with a 4px gap.
- [ ] **DS-20 — Ask/composer entry.** The prominent question entry is 10px radius, 10px by 14px padding, quiet fill, and a normal border. In the prototype it turns red on focus only for the bottom composer; general form-field focus is not defined.
- [ ] **DS-21 — Tags/chips.** Status tags are compact, 11px/600, lightly letter-spaced, and use a 4px radius in the final visual layer. A tag has a semantic wash and matching line, not a solid loud fill.
- [ ] **DS-22 — Scope selector.** Scope chips are white outlined pills when off; the active scope is a red wash with red outline and navy text. They answer “where does this apply?” rather than acting as decoration.
- [ ] **DS-23 — Citation token.** A citation is a small outlined `999px` pill on quiet blue-grey, with navy text. Hover changes it to accent wash/red. It is a source-opening control, not a generic badge.
- [ ] **DS-24 — Table/list.** Table headers are 11px uppercase muted labels. Rows use 10px horizontal padding, 10% navy bottom dividers, and a faint red hover wash. The row itself is the detail affordance.
- [ ] **DS-25 — Repeated list row.** Use one small icon/avatar column, one main line, quiet supporting text, and a right-aligned time/status/action only where it helps scanning. Prefer dividers over boxed mini-cards.
- [ ] **DS-26 — Tabs.** Horizontal tabs sit on a quiet bottom divider. Active state has navy text, a red bottom edge, and red wash; inactive tabs stay muted. Keep the tab location/order stable within a surface.
- [ ] **DS-27 — Segmented view control.** Board/Calendar-style switches sit inside one 6px outlined wrapper. Each option is 32px high; active choice uses red wash with navy text, not a separate filled button.
- [ ] **DS-28 — Navigation item.** Rail entries are at least 42px tall with 9px by 12px padding, 8px radius, icon plus label, and muted text. Active state is red wash plus a 4px red marker at the outer left and a subtle outline.
- [ ] **DS-29 — Modal sheet.** Sheets/palette panels are white, 8px radius, 1px normal-line border, and overlay shadow over a light navy scrim. The ordinary sheet is 520px wide with 22px padding; palette is 560px wide.
- [ ] **DS-30 — Side peek.** A source/detail peek enters from the right at 480px wide, below the 56px top bar, with a left border and overlay shadow. It shows supporting detail without discarding the parent context.
- [ ] **DS-31 — Menu / command palette.** Results use compact 9px by 12px rows with 8px radius; hover and selected state are accent wash. Keyboard cue is muted and right-aligned.
- [ ] **DS-32 — Empty state.** An empty state is a quiet, centred 13px message in a `#f3f6fb` panel with 26px padding, 8px radius, and dashed normal-line border. Its words name what is absent and stay calm: “Nothing waiting on you.” “No meetings linked yet.”
- [ ] **DS-33 — Toast.** A toast is a single short navy `#2b2d42` message with white 13px text, 10px by 18px padding, 8px radius, and overlay shadow. It rises from bottom-centre; it confirms a small action, not a complicated choice.
- [ ] **DS-34 — Calendar event.** An event is a compact light-red block with a 3px red left edge, 4px radius, and 6px by 8px padding. A neutral team event may use the quiet surface and grey edge instead.
- [ ] **DS-35 — Progress/meter.** A meter is a quiet, rounded 7px track with semantic fill: green normal, amber warning, red low. Use it as a compact supporting signal, never as the only explanation.
- [ ] **DS-36 — Checkbox rows.** A checkbox task/settings row is a 10px-gapped horizontal line with a quiet divider underneath. Use the brand accent for the native checkbox; completed task text is struck through and muted.

### Page and information patterns

- [ ] **DS-37 — Desktop frame.** The app is a 56px top bar plus a 220px left rail. The rail is quiet blue-grey; main content is white and scrolls independently.
- [ ] **DS-38 — Page frame.** Standard pages sit inside a 1420px maximum-width frame with `24px 32px 64px` padding. Start with title plus one short muted sentence, then the controls and content.
- [ ] **DS-39 — Top bar.** Keep the brand on the left, breadcrumb/context after it, a bounded global find control, then trust/status and small icon actions on the right. The bar is white with a quiet divider.
- [ ] **DS-40 — One primary job per view.** The screen should make the advisor’s immediate action obvious: the day’s work, a client’s facts, a meeting review, a list, or a small administration task. Supporting tools stay quiet or behind an on-demand control.
- [ ] **DS-41 — List before detail.** Lists are dense and scannable; clicking a row opens a full detail, side peek, or sheet. Do not put full editable detail into every list row.
- [ ] **DS-42 — Detail uses a stable local spine.** A client detail uses a compact identity head, then persistent tabs and grouped content. A meeting detail keeps the same tab strip and detail structure whether it is upcoming or past.
- [ ] **DS-43 — Two columns only for a real pairing.** The prototype uses 3:2 or 5:7 paired columns for summary/action, daily timeline/judgment, or content/support. Do not make three or four thin panels just to fill width.
- [ ] **DS-44 — Board columns are modest.** Board/list states use three equal columns with 14px gaps and 10px spacing between cards; headings sit directly above each column.
- [ ] **DS-45 — Keep information dense but breathable.** Use small supporting type, row dividers, short summaries, and grouped actions. Avoid dashboard-style decoration, huge cards, and large unused gaps.
- [ ] **DS-46 — “One card” law.** One user decision or closely related job belongs in one card with its evidence, status, and actions together. Do not split a single Client profile into several separate top-level cards merely because its sections are implemented separately.
- [ ] **DS-47 — “One card” exception.** Separate cards are correct when they are separate jobs (for example, a proposed action versus today’s work list), or when a side-by-side comparison needs two field boxes. Do not turn this into a literal “one card per page” rule.
- [ ] **DS-48 — Put safety/context close to the action.** Consent, source proof, sync/write-back, and “review before send” cues appear as small chips, callouts, or subtext next to the relevant decision, not as a wall of global warnings.
- [ ] **DS-49 — Keep the system door single.** Administrative areas collect under one low-priority System navigation entry. Main daily work should not look like settings.

### Interaction and state patterns

- [ ] **DS-50 — Hover is quiet and consistent.** Interactive rows, rail links, and secondary buttons use a faint navy or red wash; cards gain a subtle border/shadow change only where the whole card opens detail.
- [ ] **DS-51 — Selection is clear without being loud.** Selected nav/tab/scope controls use accent wash, navy text, and where useful a red edge/marker. Do not use red text alone as the only selected-state cue.
- [ ] **DS-52 — Reveal actions at the point of judgment.** Approve / Edit / Reject occur within a proposal card. Draft/send flows use clear review language before an external action. Keep destructive or irreversible actions visually secondary until the confirmation moment.
- [ ] **DS-53 — Confirm in plain past tense.** Toasts state the completed outcome: “Saved here and synced to Outlook ✓”, “Team access saved and audited”, “Done ✓”. Avoid vague “Success” messages.
- [ ] **DS-54 — Explain what will happen before a consequential action.** A merge sheet says what moves and that an audit record remains; a review screen says nothing sends until review. Use short concrete sentences, not legalistic filler.
- [ ] **DS-55 — Empty, unavailable, and partial are different.** Empty states say what is not there; an excluded/uncertain recipient gets an amber “unverified — excluded” tag; a screen only modeled at navigation level says so. Do not disguise missing capability as an empty list.
- [ ] **DS-56 — Loading is a prototype gap.** The frozen v2 has “Refreshing…” toast wording but no spinner, skeleton, progress layout, or timed loading-state style. A reviewer cannot grade a new loading screenshot against a frozen visual rule; it needs a small follow-on design decision.
- [ ] **DS-57 — Error and validation are a prototype gap.** The prototype gives no reusable inline field-error treatment, error summary, or retry state. Do not infer one from the amber/red tags; a new form flow needs a reviewable design choice.
- [ ] **DS-58 — Focus is only partly specified.** The bottom Ask composer gets a red border on focus. General inputs/selects remove browser outline but have no shared focus rule. New controls must retain visible keyboard focus, but its exact visual treatment is unresolved by the prototype.

### Copy tone

- [ ] **DS-59 — Sound calm, helpful, and specific.** Use direct everyday language that says what the advisor can do or what changed: “Review both records before anything is combined.”
- [ ] **DS-60 — Labels are short nouns or clear verbs.** Examples: “New client,” “Save event,” “Review merge,” “What changed?”, “Client access.” Avoid marketing slogans and unexplained technical names.
- [ ] **DS-61 — Supporting copy explains the boundary.** Use a short second sentence to say scope, privacy, or consequence: “These prefill one task. They do not start a workflow.”
- [ ] **DS-62 — Empty copy is reassuring, not apologetic.** Prefer “Nothing waiting on you,” “No threads yet,” or “All action items handled.” Add a next step only when one is useful.
- [ ] **DS-63 — Use truthful operational language.** Say “prototype” where the interaction is only demonstrated; say “review before anything sends” for approval-gated actions; say “verified” only next to the proof source/state.
- [ ] **DS-64 — Keep confirmation words concrete.** Name the thing saved, sent, updated, or excluded. Include the destination when it matters (“synced to Outlook”).

## Known deviation staged for Jameson

- [ ] **DS-65 — Record profile structure is currently a known decision, not a silent exception.** The frozen prototype nests the four record sections inside one top-level **Client profile** card. The current product renders those sections as separate top-level cards. This differs from the approved visual specification and is staged for Jameson’s Legion drive; do not declare screenshots compliant by calling the implementation convenience a design rule.

## Internal inconsistencies and limits in the frozen prototype

1. **Two visual systems exist in the same file.** The first CSS block uses warm off-white, dark charcoal, orange `#b4540a`, 10px cards, and a solid-orange primary button. The later CSS block overrides the important shared selectors with the actual v2 white/navy/red system above. Screenshot review follows the later cascade.
2. **Primary-action treatment changes across the two blocks.** The rendered layer makes primary buttons pale red with navy text, while `accent` itself stays bright red and some other components use it as a solid line. Treat DS-15 as authoritative for buttons; do not extrapolate a solid red button.
3. **Tag shape is inconsistent across the cascade.** The base `.chip` is pill-shaped (`999px`); the final override is `4px`. Rendered standard chips should be 4px, while scopes/citations/pills remain explicitly pill-shaped.
4. **Radius naming is not perfectly uniform.** The final shared token is 8px, but older definitions and special controls retain 10px/12px/14px. The shape ladder in DS-10 captures what actually renders rather than pretending there is one universal radius.
5. **Not every hover/focus/loading/error state is implemented.** DS-50 through DS-58 distinguish designed behaviour from gaps. These gaps should be resolved deliberately when a new surface needs them.
6. **Prototype-only wording exists.** Some toasts explicitly say “(prototype)” and several screens say they are modeled only at navigation level. Preserve the visual grammar, but do not treat those placeholder claims as final product copy.

## Evidence locations

- Frozen prototype CSS and rendered visual overrides: `/home/jameson/lantern/design/fable-v2-lantern/prototypes/fable-v2/index.html` (base tokens at lines 7–249; final visual layer at lines 251–364).
- Portal pin: `/home/jameson/lantern/design/index.html` (highlighted first card, lines 29–33).
- Freeze decision: `MASTER-TRACKER.md` Design track, lines 8–10.
- Known record-card delta: `MASTER-TRACKER.md` around line 177 and `prep/carryforward/SUMMARY.md` line 16.
