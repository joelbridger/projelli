# Sonnet vision checklist — record-employment

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `advisorProfileSections()` (Employment subsection, lines ~648-651).

Real app: `EmploymentSection` at `src/features/crm-clients/extensions/employment/EmploymentSection.tsx`, mounted by `employmentHouseholdSection` into `householdSectionRegistry`, `tab: 'client_map'`.

Screenshot(s): `02-record-employment-on.png` (flag ON, isolated), `05-records-all-on.png` (hierarchy), `00-records-off.png` (absence).

## Frozen prototype spec (Employment subsection)

- Icon (▤) + title "Employment" + helper "Work, income, and retirement dates"
- Fields: [Person]'s occupation, Occupation start, Planned retirement, Gross annual income

## Real-app structure

- Own `Card` (`crm-employment-section`), title = `employment.title`, helper = `employment.helper`
- Per-household-member selector (`crm-employment-member`) — the prototype shows one person's occupation inline in a single-person household; the real app generalizes to multi-member households with a member picker. This is a superset, not a mismatch, since Foster household in the prototype only ever names Robert's occupation.
- Editable fields: occupation, **employer** (`crm-employment-employer` — not in the prototype's field list, an added field), occupation start, planned retirement (+ free-text reduced-schedule context), gross annual household income
- Read state: definition-list rows for occupation, employer, occupation start, planned retirement (+ reduced-schedule suffix), gross income

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Occupation, occupation start, planned retirement, gross income fields present and match prototype vocabulary | PASS | `02-record-employment-on.png` — title "Employment", helper "Work, income, and retirement dates" (verbatim prototype match), all rows visible: Occupation, Employer, Occupation start, Planned retirement, Gross annual income, all "Not set" (correct empty state) |
| Additional "Employer" field beyond the prototype's four fields | **Expected superset**, not a delta (prototype's fields are a subset) | same screenshot |
| Per-member selector (household has 2 members) generalizes the prototype's single-person case correctly | PASS | "Household member" dropdown showing "Dana Whitfield" visible and selectable |
| Light theme, calm card hierarchy | PASS | screenshot |
| Structural hierarchy: separate top-level card vs. prototype's nested subsection | **Expected DELTA** (see compliance-dates checklist rationale) | `05-records-all-on.png` shows Employment as its own bordered card directly below Professional contacts |
| Flag OFF → section absent | PASS | `00-records-off.png` |

OVERALL: **PASS** — title, helper copy, and all four prototype fields match exactly; the member selector is a correct, sensible generalization of the prototype's single-person household case. Same expected one-card-per-lane structural delta as the other three record sections.
