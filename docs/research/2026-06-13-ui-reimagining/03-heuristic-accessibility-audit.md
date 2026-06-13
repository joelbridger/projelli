# Heuristic + Accessibility Audit — Keepance Current UI
**Date:** 2026-06-13  
**Stream:** C (Objective Research — Design Principles)  
**Scope:** Light-mode UI at HEAD. Evaluation against Nielsen's 10 Usability Heuristics and WCAG 2.1 AA.  
**Target user:** Non-technical litigation attorney.  
**Severity scale:** P1 = blocks use or fails hard standard; P2 = degrades experience materially; P3 = improvement worth making.

---

## 1. Color-Contrast Table

All ratios computed from the HSL definitions in `src/styles/globals.css` using the WCAG relative-luminance formula (sRGB linearization → L = 0.2126R + 0.7152G + 0.0722B; ratio = (L1+0.05)/(L2+0.05)).

| Token pair (foreground on background) | Computed ratio | AA threshold | Result |
|---|---|---|---|
| `--color-foreground` on `--color-background` (white) | 20.0 : 1 | 4.5 : 1 normal | **PASS** |
| `--color-primary` (#0A2540) on white | 15.5 : 1 | 4.5 : 1 normal | **PASS** |
| `--color-primary-foreground` (white) on `--color-primary` | 15.5 : 1 | 4.5 : 1 normal | **PASS** |
| `--color-muted-foreground` on `--color-background` (white) | 4.76 : 1 | 4.5 : 1 normal | **PASS (marginal)** |
| `--color-muted-foreground` on `--color-muted` (96.1% L) | **4.34 : 1** | 4.5 : 1 normal | **FAIL** |
| `--color-border` on `--color-background` (white) — non-text UI component | **1.23 : 1** | 3.0 : 1 (WCAG 1.4.11) | **FAIL** |
| `--color-destructive` (hsl 0 84.2% 60.2%) on white | **3.76 : 1** | 4.5 : 1 normal | **FAIL** |
| `--color-destructive-foreground` (near-white) on `--color-destructive` | **3.65 : 1** | 4.5 : 1 normal | **FAIL** |
| `text-amber-500` (#f59e0b, Tailwind) on white — used as status text | **2.15 : 1** | 4.5 : 1 normal | **FAIL** |
| `text-amber-700` (#b45309, Tailwind) on white — used in status bar | 5.02 : 1 | 4.5 : 1 normal | **PASS** |
| `text-sky-700` (#0369a1) on white — egress pulse text | 5.93 : 1 | 4.5 : 1 normal | **PASS** |
| `--color-secondary-foreground` (hsl 222.2 47.4% 11.2%) on `--color-secondary` | 16.3 : 1 | 4.5 : 1 normal | **PASS** |

**Notes on border ratio:** The 1.23:1 ratio applies to all decorative and structural borders (section dividers, card outlines, input field outlines) since they all use `--color-border` against the white or card background. Input field borders fail WCAG 1.4.11 (Non-text contrast, AA). The token appears in the global `* { border-color: var(--color-border); }` rule at `src/styles/globals.css:51`, so the failure is systemic.

**Note on `text-amber-500`:** This value (#f59e0b) is applied as text color on white or near-white backgrounds in multiple components (status bar "modified" indicator `StatusBar.tsx:348`, tab bar dirty-marker `TabBar.tsx:795`, tab group dirty-marker `TabBar.tsx:1039,1227`, sparkle icon in `TabBar.tsx:68`, and sparkle icon in `UpdateReleaseNotesModal.tsx:47`). The 2.15:1 ratio is well below both the 4.5:1 normal-text and the 3:1 large-text thresholds.

---

## 2. Nielsen Heuristic Findings

### H1 — Visibility of System Status

**Finding H1-A (P2): Status bar is critically dense.** `StatusBar.tsx:237-458`. The status bar is `h-6` (24 px) with `text-xs` (12 px) and packs up to nine simultaneous indicators in a horizontal strip: breadcrumb trail, trial chip, active file name, modified indicator, privileged-matter badge, egress-activity pulse, egress indicator, matter scope badge, RAG status badge, tab count, and a bug-report CTA. The attorney's eye has nowhere to anchor. State changes (e.g. confidentiality mode switching from Direct to Assured) happen in a region that already looks fully occupied.  
*Direction:* Collapse to a 3-5 item tray; surface security state prominently above the fold, not in a 24-px strip.

**Finding H1-B (P1): "Modified" indicator text fails contrast and is invisible.** `StatusBar.tsx:348`. The `text-amber-500` class produces 2.15:1 against the card background — below even the large-text threshold. An attorney who is actively editing a document receives no usable visual feedback that the file is unsaved.  
*Direction:* Use `text-amber-700` (5.02:1, already used nearby for the matter-scope indicator) or add a background chip.

**Finding H1-C (P2): Onboarding progress dots have no numeric or textual label.** `FirstRunWizard.tsx:169-180`. The six step-dots are colored divs; nothing communicates "Step 3 of 6" to sighted users reading quickly or to screen readers. A non-technical attorney re-opening the wizard after being interrupted cannot determine how far they are.  
*Direction:* Add visible "Step N of 6" text below the dots; also add `aria-label` to each dot.

**Finding H1-D (P3): RAG/memory badge is text-only, no semantic live region.** `RagStatusBadge.tsx`. The badge renders a text label but has no `aria-live` on its container div. If the indexing state changes ("indexing 47/312" → "ready"), screen readers are not notified.  
*Direction:* Add `aria-live="polite"` to the outer div (like `ModelDownloadCard.tsx` already does correctly).

---

### H2 — Match Between System and the Real World

**Finding H2-A (P2): "Workspace" metaphor is developer-centric.** Onboarding (e.g. `FirstRunWizard.tsx:263-299`) refers to "workspace," "folder path," and provides example paths like `~/Dropbox/Keepance`. A non-technical attorney does not think in folder paths.  
*Direction:* Rename to "Your Keepance folder" or "Your practice folder"; provide a file-picker CTA rather than path-input as the primary path.

**Finding H2-B (P2): Sidebar has developer-pattern tabs.** `Sidebar.tsx:115-128`. Ten tabs include "Research," "Whiteboard," "Workflows," "Audit," and "Plugins" — concepts alien to a litigation attorney's daily vocabulary. "AI Assistant" is buried 5th.  
*Direction:* Restructure into attorney-domain groupings: Matters, Documents, Ask AI; relegate power-user features to a secondary pane or settings.

**Finding H2-C (P3): Icon meanings are not self-evident.** In collapsed sidebar mode all tabs are icon-only. `Bot` (AI Assistant), `BookOpen` (Research), `History` (Audit), `PenTool` (Whiteboard) are not mapping to attorney mental models without labels.

---

### H3 — User Control and Freedom

**Finding H3-A (P2): Split-view secondary pane selector has no accessible name.** `MainPanel.tsx:975-979`. The file `<select>` for the secondary pane is preceded by a `<span className="text-xs text-muted-foreground mr-2">Split View:</span>` which is not a semantic `<label>`. The select cannot be identified by screen readers or label-matching heuristics.  
*Direction:* Replace with `<label htmlFor="secondary-pane-select">` and give the select an `id`.

**Finding H3-B (P3): No persistent undo indication.** The UI has undo/redo but no status bar token indicating the undo stack depth. An attorney who accidentally deletes content has no reassurance that undo is available.

---

### H4 — Consistency and Standards

**Finding H4-A (P2): Mixed close-action patterns.** The split pane close button is a full text Button ("Close") at `MainPanel.tsx:987-996`; the right panel close is icon-only (`PanelRightClose`) at `MainPanel.tsx:1416-1428`; sidebar collapse uses a chevron at `Sidebar.tsx:184-197`. Three different patterns for "dismiss a panel."  
*Direction:* Standardize on icon + visible label for all panel-close actions in the document area.

**Finding H4-B (P3): `text-destructive` usage is inconsistent.** The token is applied to icon colors (`Trash2`, `AlertTriangle`, text labels), interactive button text, and background-filled destructive buttons. At 3.76:1 on white, the color communicates "danger" only to users with good contrast sensitivity — and even then it fails WCAG.

---

### H5 — Error Prevention

**Finding H5-A (P2): Profession selection in onboarding has no confirmation state for screen readers.** `FirstRunWizard.tsx:228-243`. Clicking a profession card sets the `profession` state and applies `bg-primary/10 border-primary` styling, but the `<button>` element has no `aria-pressed` or `aria-selected` attribute. A screen reader user cannot confirm their selection.  
*Direction:* Add `aria-pressed={profession === option.id}` to each profession button, or use `role="radio"` / `role="radiogroup"` semantics.

**Finding H5-B (P3): Error text at `text-destructive` fails 4.5:1.** `FirstRunWizard.tsx:427-429`, `LicenseSettings.tsx:277`, `RagStatusBadge.tsx:42`. Error messages rendered as `text-destructive` on white are 3.76:1 — below the AA threshold for normal-size text. An attorney with moderate vision impairment may not see the error state.

---

### H6 — Recognition Rather than Recall

**Finding H6-A (P2): Collapsed sidebar requires hover for labels.** `Sidebar.tsx:260-275`. When the sidebar is collapsed, labels are only available via `TooltipContent` (hover/focus). The `title` attribute is explicitly suppressed on collapse (`title={!isCollapsed ? tooltipLabel : undefined}` at line 249). A user who cannot hover (touch screen, keyboard-only) or who has not learned the icon set cannot identify pane tabs.  
*Direction:* Provide persistent icon-label pairs at a minimum; or use a rail navigation pattern that always shows abbreviated labels.

**Finding H6-B (P3): TabBar groups hide individual file names.** When multiple files are grouped, individual names disappear behind a chip. Tab context is lost when the tab bar overflows, which happens quickly in an attorney's typical multi-document session.

---

### H7 — Flexibility and Efficiency of Use

**Finding H7-A (P2): No visible keyboard shortcut discovery surface in the main editor area.** Keyboard shortcuts exist (`Ctrl+B` collapse, `Ctrl+\` split, etc.) but are surfaced only through `title` tooltips (invisible without hover) and the ShortcutsOverlay. A power user who works keyboard-first must remember shortcuts or find the overlay.  
*Direction:* Display a keyboard shortcut inline next to actions in the overflow menu (already follows this pattern for some shortcuts; generalize it).

---

### H8 — Aesthetic and Minimalist Design

**Finding H8-A (P1): Status bar violates minimalism at the information tray.** See H1-A. Nine active indicators in 24px is the clearest violation of minimalism in the app. Each individual element is visually small; together they create noise that trains attorneys to ignore the bar.

**Finding H8-B (P2): Empty-state icon is generic.** `MainPanel.tsx:614-619`. The "no file open" state shows a generic `FileText` icon at h-16 w-16 with 50% opacity and two lines of gray text. For a lawyer's first session this is a missed moment to orient them toward "open a matter" or "start an AI chat." The onboarding card (`ApiKeySetupCard`) already improves this when keys are missing, but the fallback is very bare.

**Finding H8-C (P3): Sidebar border and background blend together.** With `--color-border` at 1.23:1 against the card background, structural dividers (section header borders, sidebar/main-panel divider) are near-invisible, creating ambiguity about where the sidebar ends and the main panel begins.

---

### H9 — Help Users Recognize, Diagnose, and Recover from Errors

**Finding H9-A (P2): `muted-foreground` on `muted` background fails AA for normal text.** The secondary text in many panels (e.g. RAG badge, matter scope text, sidebar heading labels) is rendered as `text-muted-foreground` against `bg-muted` surfaces. Computed ratio: 4.34:1 — below the 4.5:1 AA minimum for text at `text-xs` (12px). An attorney with mild age-related contrast sensitivity loss (common at 40+) will struggle to read sub-labels in the sidebar.

**Finding H9-B (P3): Inline title rename in MainPanel has no cancel affordance on touch.** `MainPanel.tsx:1021-1037`. Pressing Escape cancels; onBlur commits. On touch devices (potential future vector) or for users who don't know Escape, there is no visible cancel button.

---

### H10 — Help and Documentation

**Finding H10-A (P2): "Where does my data go?" trust story is buried in onboarding only.** The `DataMapDialog` is accessible from the AI setup step and via a privacy section, but there is no persistent access from the main UI. For a litigation attorney with privilege obligations, the egress story needs to be one click away at all times, not behind a wizard step they saw once.  
*Direction:* Add a "Privacy" or "Data Map" link/button to the status bar egress indicator cluster (the compact indicator already has a `title` tooltip; a clickable variant opening the DataMapDialog would close the loop).

---

## 3. WCAG 2.1 AA Findings

### 1.1.1 Non-text Content

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Privileged matter badge icon (`ShieldOff`) has `aria-hidden` but its wrapping div has only `title`, no `aria-label` | `StatusBar.tsx:362-374` | P2 | Add `aria-label` to the wrapping div, e.g. "Privileged Matter Mode active — network extensions disabled" |
| Matter row in sidebar: `ShieldAlert` icon carries `aria-label` directly on the icon element rather than being aria-hidden and the parent labeled | `MattersSidebarPanel.tsx:70` | P3 | Move `aria-label` to the parent row button or make icon `aria-hidden` and add SR text |
| FirstRunWizard step progress dots: no text alternative | `FirstRunWizard.tsx:172-180` | P1 | Add `aria-label="Step N of 6"` and visible text label |

### 1.3.1 Info and Relationships

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Split-view file `<select>` has no associated `<label>` — adjacent `<span>` is decorative | `MainPanel.tsx:975-979` | P2 | Replace `<span>` with `<label htmlFor="secondary-file-select">` |
| Right panel header ("Outline" / "Backlinks" / "Version History") is a `<span>` inside a flex div with no heading role; panel content lacks `aria-label` tying it to its heading | `MainPanel.tsx:1412-1415` | P3 | Use an `<h3>` or add `aria-labelledby` on the panel region |
| FirstRunWizard is a full-screen overlay with no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, and no focus trap | `FirstRunWizard.tsx:164-165` | **P1** | Wrap in a Radix `<Dialog>` or add `role="dialog" aria-modal="true" aria-labelledby="wizard-title"` plus a `FocusTrap` |

### 1.4.1 Use of Color

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Tab dirty-state marker (`•`) is `text-amber-500` — color as sole distinguishing signal at 2.15:1 | `TabBar.tsx:795, 1039, 1227` | P1 | Change to `text-amber-700` or supplement color with a distinct shape/label |
| Sidebar active tab relies primarily on background fill (`bg-secondary`) vs no-background (`ghost`); secondary visual cue is text color change from `text-muted-foreground` to inherited foreground. Not color-alone but the background-only change is weak at narrow widths | `Sidebar.tsx:233-242` | P3 | Add a left-border accent on active tab (color + position = two signals) |

### 1.4.3 Contrast (Minimum)

| Finding | Location | Severity |
|---|---|---|
| `text-amber-500` on white = 2.15:1 (normal text, `text-xs`) | `StatusBar.tsx:348`, `TabBar.tsx:68,795,1039,1227`, `UpdateReleaseNotesModal.tsx:47` | **P1** |
| `text-destructive` on white = 3.76:1 (normal text, multiple sizes) | `LicenseSettings.tsx:277`, `FirstRunWizard.tsx:429`, `RagStatusBadge.tsx:42`, `AutoSaveIndicator.tsx:93,128`, `TabBar.tsx:1069`, `TrashPanel.tsx:149,219,312,392` | **P1** |
| `muted-foreground` on `muted` bg = 4.34:1 (normal-size text at `text-xs`) | Sidebar section headers, status bar base text `StatusBar.tsx:241`, many secondary labels | **P1** |
| Destructive button: `--color-destructive-foreground` (near-white) on `--color-destructive` = 3.65:1 | `src/components/ui/button.tsx:14` — the `destructive` variant | **P1** |

### 1.4.11 Non-text Contrast

| Finding | Location | Severity |
|---|---|---|
| `--color-border` on white = 1.23:1. All input fields, card outlines, section dividers in the UI fail the 3:1 minimum for UI components | `src/styles/globals.css:51` (global border rule); affects every `<input>`, `<textarea>`, `<select>`, card, and structural divider | **P1** |

### 2.1.1 Keyboard

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Rename-file button in editor title strip has no `focus-visible` ring class | `MainPanel.tsx:1045-1053` (`className="h-6 w-6 p-0 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"`) | P2 | Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| Breadcrumb buttons use `focus-visible:ring-1` (1px ring, very thin against light backgrounds) | `StatusBar.tsx:485` | P3 | Widen to `ring-2` |
| Matter list buttons in sidebar have no explicit `focus-visible` ring | `MattersSidebarPanel.tsx:61-64` | P2 | Add `focus-visible:ring-2 focus-visible:ring-ring` |
| Onboarding "Skip for now" button has no visible focus ring (`text-xs text-muted-foreground hover:text-foreground transition-colors`) | `FirstRunWizard.tsx:183-187` | P2 | Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded` |

### 2.4.3 Focus Order

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| `FirstRunWizard` (fixed overlay) lacks a focus trap. Focus can escape the wizard to background content, creating a confusing tab order | `FirstRunWizard.tsx:164-451` | P1 | Implement focus trap (Radix FocusScope or equivalent) |

### 2.4.7 Focus Visible

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Sidebar tabpanel container has `focus:outline-none` suppressing visible focus when the panel region is programmatically focused | `Sidebar.tsx:290` | P2 | Remove `focus:outline-none` or replace with `focus-visible:outline-none` (only suppress on mouse, not keyboard) |
| Editor prose area (`RichTextEditor.tsx:99`, `RtfEditor.tsx:128`) uses `focus:outline-none` on the ContentEditable — this is expected for prose editors, acceptable if the editor frame has a visible focus ring | Acceptable | — | No action needed if outer container has visible focus ring |

### 4.1.2 Name, Role, Value

| Finding | Location | Severity | Recommendation |
|---|---|---|---|
| Compact `EgressIndicator` div has no `role` or `aria-label`; communicates trust state only via title tooltip | `EgressIndicator.tsx:143-160` | P2 | Add `role="status"` and `aria-label={label + '. ' + note}` so screen readers can read the egress state |
| Matter scope div in status bar has `data-scope` but no `aria-label` | `StatusBar.tsx:415-436` | P2 | Add `aria-label` reflecting the active matter name or "All matters" |
| FirstRunWizard has no `role="dialog"` | `FirstRunWizard.tsx:164` | P1 | See 1.3.1 above |
| Profession selection cards have no `aria-pressed` or radio semantics | `FirstRunWizard.tsx:228-243` | P2 | Add `aria-pressed={profession === option.id}` |

---

## 4. Top-10 Prioritized Fix List

These are the highest-impact issues the redesign must address, severity-ranked. Items 1-4 are hard standards failures that exist regardless of the redesign scope.

| Rank | Issue | Criterion / Heuristic | Severity | Files |
|---|---|---|---|---|
| 1 | **`text-amber-500` on white = 2.15:1** — dirty-state markers and sparkle icons are invisible under typical age-related contrast decline | WCAG 1.4.3 | P1 | `StatusBar.tsx:348`, `TabBar.tsx:68,795,1039,1227` |
| 2 | **`--color-border` on white = 1.23:1** — every input field, card, and divider in the product fails non-text contrast; attorneys cannot reliably distinguish interactive form elements from their surroundings | WCAG 1.4.11 | P1 | `globals.css:24,51` — systemic |
| 3 | **`text-destructive` on white = 3.76:1** — error states, delete actions, and memory-error indicators all fail AA for normal-size text | WCAG 1.4.3 | P1 | `globals.css:22`; used in >10 components |
| 4 | **FirstRunWizard is an uncontained modal** — no `role="dialog"`, no `aria-modal`, no focus trap; a screen reader user cannot operate onboarding | WCAG 1.3.1, 2.4.3, 4.1.2 | P1 | `FirstRunWizard.tsx:163-165` |
| 5 | **Status bar information overload** — 9+ simultaneous status signals in a 24-px h-6 bar trained the user to ignore it; critical security state (egress mode, privileged matter) competes with tab counts and bug-report links | Nielsen H1, H8 | P2 | `StatusBar.tsx:237-458` |
| 6 | **`muted-foreground` on `muted` background = 4.34:1** — secondary labels throughout the UI (sidebar headings, status bar base text) fail AA for small text; especially impactful for attorneys over 45 | WCAG 1.4.3 | P1 | `globals.css:19` — systemic |
| 7 | **Sidebar collapsed mode: icon-only navigation with no fallback** — labels visible only on hover, suppressed on keyboard focus in collapsed mode; attorneys who don't hover cannot identify panes | Nielsen H6; WCAG 2.1.1 | P2 | `Sidebar.tsx:246-275` |
| 8 | **Rename-file button and matter-list rows lack visible focus rings** — two critical interactive surfaces are keyboard-inaccessible in practice | WCAG 2.4.7, 2.1.1 | P2 | `MainPanel.tsx:1045-1053`, `MattersSidebarPanel.tsx:61-64` |
| 9 | **Profession-card and egress-indicator missing ARIA state/role** — profession selection has no `aria-pressed`; compact egress badge has no `role="status"` or `aria-label`; the trust story is invisible to screen readers | WCAG 4.1.2, 1.1.1 | P2 | `FirstRunWizard.tsx:228-243`, `EgressIndicator.tsx:143-160` |
| 10 | **Sidebar tabpanel's `focus:outline-none`** suppresses the visible keyboard-focus indicator when keyboard users reach the panel container | WCAG 2.4.7 | P2 | `Sidebar.tsx:290` |

---

## Appendix: Accessibility Baseline Observations

**Strengths already in place (evidence-based):**
- Sidebar ARIA tablist is correctly implemented: `role="tablist"`, per-tab `role="tab"`, `aria-selected`, `aria-controls`, `tabIndex` roving pattern, arrow-key + Home/End keyboard navigation (`Sidebar.tsx:200-278`).
- `ModelDownloadCard.tsx` demonstrates correct progressive disclosure of ARIA: `role="progressbar"` with `aria-valuemin/max/now`, rate counter in `aria-live="off"` to avoid verbosity flood.
- Icon-only buttons in clearly-established contexts carry `aria-label` (TTS `AudioControlBar`, vault `RecoveryPhraseCeremony`, editor toolbar `RichTextEditor`).
- shadcn/ui `dialog.tsx` provides a visible "Close" SR label.
- `VaultLockedPrompt`, `VisionWarningBanner`, `VaultEscapeHatchDialog` all correctly use `role="alert"` for urgent messages.

**Systemic gaps:**
- The four contrast failures in the token table are architectural — they affect every component that uses those tokens. Fixing them in `globals.css` alone propagates the fix everywhere.
- Focus ring suppression (`focus:outline-none` without the `focus-visible:` modifier) appears in `Sidebar.tsx:290`, `RichTextEditor.tsx:99`, `RtfEditor.tsx:128`, `InlineChatAnchor.tsx:105,134`. The pattern is inconsistently applied — some components correctly use `focus-visible:outline-none` (shadcn/ui button primitive), others suppress all focus outlines including keyboard focus.
