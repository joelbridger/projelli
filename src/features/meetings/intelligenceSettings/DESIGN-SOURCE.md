## Design source and review gate

**DESIGN SOURCE:** Frozen prototype, Settings pages and shared rendered visual layer.

- **Frozen-prototype pointer:** `/home/jameson/lantern/design/fable-v2-lantern/prototypes/fable-v2/index.html`, using the Settings page layout and the later “Current Lantern V1 visual layer”; the governing extraction is `design/DESIGN-SYSTEM.md`, DS-1 through DS-21 and DS-32.

This panel stays inside the existing Scheduling section. It uses the existing light canvas, quiet card, thin border, modest heading, compact rows, and calm empty panel. It deliberately does not create a new route, rail item, or dashboard.

IA-MAP line 114 keeps meeting intelligence itself beside meeting detail, prep, review, and client context. This panel is in Settings only because it administers firm-wide defaults and catalogue definitions; it is not the place where advisors use or view meeting intelligence.

State decisions derived from the source:

- Populated: one preference card followed by simple type and template lists.
- First run: defaults come from the canonical record; empty catalogues use the quiet dashed empty panel from DS-32.
- Saving: the affected controls are disabled and the action says “Saving…”.
- Error: DS-57 leaves this unspecified. This panel uses one plain, pale danger callout with a “Try again” button; it does not treat brand red as an unexplained failure marker.
- Flag off: the outer Settings registry gate omits the panel entirely, before the mounted panel can load its stores.

**DESIGN REVIEW REQUIRED:** Before merge, dispatch an independent designer-persona review using `prep/DESIGN-REVIEW-MANDATE-TEMPLATE.md`. Supply populated, first-run, saving, error, and flag-off captures plus the surrounding Scheduling Settings view. `DESIGN-CHANGES` blocks merge until the stated changes are made and re-reviewed.

**PRE-MERGE EVIDENCE OWED:** Capture the populated, first-run, saving, error, and flag-off states with their surrounding Scheduling Settings view before merge. This implementation round does not claim or fabricate those screenshots.
