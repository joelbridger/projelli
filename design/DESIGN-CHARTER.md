# Lantern Design Charter

**Status: DRAFT-PENDING-BLESSING**  
**Purpose:** This is the lasting promise for how Lantern should feel. Jameson must bless this draft before it becomes the charter.

## Who we are designing for

Lantern is for a financial advisor and the small team around them. Their day is full of people, promises, meetings, documents, and follow-up work. They need to understand a client quickly, pick the next useful action, and trust what the app says without having to study the app first.

They are not looking for a flashy command center. They need a calm desk: a familiar place where the important client story, the work due next, and the tools to act are close at hand. They may move between a household, a meeting, a task, a file, and a message many times a day. The product must keep that movement clear and keep their mental load low.

Lantern is a real working home for advisor work, not a thin display layer. It should preserve useful CRM familiarity while making the full client relationship and the next step easier to see. AI may help prepare, summarize, and suggest, but it must be clearly distinguishable from the advisor’s own work and must never ask for blind trust.

**Research basis:** Wealthbox parity research describes the advisor’s core work across client records, tasks, meetings, documents, communications, and firm administration; competitor analysis shows why familiar navigation, clear record detail, plain-language automation, and visible AI boundaries matter. See `../design/wealthbox-parity/FABLE-WEALTHBOX-PARITY.md` and `../design/competitor-ui/ANALYSIS.md`.

## The experience we promise

### 1. A calm, light desk — never a control room

Use a light interface, quiet surfaces, readable dark text, restrained color, and generous breathing room. Strong color is for meaning and action, not decoration. A busy advisor should feel settled on arrival, not alerted by the furniture.

**Source:** Jameson’s standing light-theme rule (Workspace `AGENTS.md`, recorded 2026-06-02); the approved v2 prototype uses a white canvas, pale rail, thin borders, and small, purposeful accents (`../design/fable-v2-lantern/VISUAL-TOKENS.md`, 2026-07-14).

### 2. Say the useful thing in ordinary words

Buttons, labels, empty states, explanations, and AI output must be short, specific, and human. Avoid insider language, vague promises, and labels that make the user decode the product. Explain what happened, what it means, and the next safe action.

**Source:** Jameson’s “explain like I am 10” communication preference (Workspace `AGENTS.md`, updated 2026-07-05); competitor research found plain-language automation rules easier to understand (`../design/competitor-ui/ANALYSIS.md`, “What feels strong,” 2026-07-14); D-series calls for a consistent, calm voice (`../design` Office blueprint, 2026-07-16).

### 3. One clear home for each piece of work

Every important thing needs an obvious place to live. A client’s story belongs together; a task, meeting, document, or decision should not make the advisor hunt across unrelated screens. When work is divided into sections, the sections must still read as one coherent whole.

**Source:** the frozen prototype is the approved visual and interaction specification (`MASTER-TRACKER.md`, 2026-07-15); the first parity pass found a real deviation when one approved “Client profile” card became four separate top-level cards, to be shown to Jameson as a design delta (`MASTER-TRACKER.md`, 2026-07-15, vision-parity entry).

### 4. Familiar paths, with fewer steps

Keep the useful conventions advisors already know: a stable left rail, clear records, focused lists, a visible next action, and secondary actions kept out of the way until needed. Reuse interaction patterns so learning one area helps with the next. Do not invent a new pattern when a familiar one does the job.

**Source:** Wealthbox and Jump research documents shared advisor-software conventions and the value of a repeatable record-detail pattern (`../design/competitor-ui/ANALYSIS.md`, “Shared patterns” and “What feels strong,” 2026-07-14); the frozen v2 prototype preserves a coherent Lantern visual language (`../design/fable-v2-lantern/README.md`, 2026-07-14).

### 5. Low ceremony, clear progress

Making progress should feel easy. Show only the choices needed now. Use helpful defaults, simple empty states, and one clear next step. Do not turn ordinary work into a sequence of tiny forms, popups, or approvals.

**Source:** Jameson’s standing preference for low ceremony and direct execution (Workspace `AGENTS.md`, recorded 2026-06-02); competitor research notes the strength of simple empty states with one sentence and one action (`../design/competitor-ui/ANALYSIS.md`, “Shared patterns,” 2026-07-14).

### 6. AI is a helpful coworker, never a mystery

Make it clear when AI prepared, suggested, or changed something. Keep the person in charge. Let them inspect, edit, and decide. AI language must be concrete enough that an advisor can judge it, and important information must carry the right caution.

**Source:** competitor analysis praises AI outputs that are specific and directly usable, and records the value of visible AI boundaries and an AI disclaimer (`../design/competitor-ui/ANALYSIS.md`, “AI Associate pattern” and “What feels strong,” 2026-07-14); D1 requires tone and do/don’t rules from the approved prototype (`CONSULTANT-FABLE-NOTES.md`, 2026-07-17).

### 7. Make the whole product feel like one product

A screen can look polished and still be wrong if it breaks the journey, uses a new visual dialect, or makes a neighbor feel foreign. Every design review checks both the surface itself and how it belongs with the surrounding journey.

**Source:** Jameson’s D2 coherence amendment requires a two-level review and names “beautifully crafted but wrong for the whole” as a failure case (`CONSULTANT-FABLE-NOTES.md`, 2026-07-17).

## How to resolve a conflict

Use this order:

1. This charter’s experience principles.
2. The approved prototype and `DESIGN-SYSTEM.md` patterns.
3. `IA-MAP.md` and the relevant journey.
4. A dated decision or Jameson blessing.
5. `JAMESON-TASTE.md` when two options still fit.

If none settles the question, write a small design decision and ask Jameson for a blessing before making a high-impact new visual direction.

## What this charter does not replace

`DESIGN-SYSTEM.md` defines the detailed visual rules. `IA-MAP.md` explains where screens and journeys belong. Both move into this office during the gated transfer; do not copy their contents here.
