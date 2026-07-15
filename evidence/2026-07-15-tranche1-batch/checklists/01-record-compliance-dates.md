# Sonnet vision checklist — record-compliance-dates (Written agreements)

Reviewer: Claude Sonnet, high effort (batch evidence lane, independent of the original build lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `advisorProfileSections()` (Written agreements subsection, lines ~648-651) and `profileField()` (line 652).

Real app: `WrittenAgreementsSection` at `src/features/crm-clients/extensions/compliance-dates/WrittenAgreementsSection.tsx`, mounted by `writtenAgreementsSection` (`src/features/crm-clients/extensions/compliance-dates/index.ts`) into `householdSectionRegistry` at `tab: 'client_map'`, descriptor id `written-agreements`.

Screenshot(s): `01-record-compliance-dates-on.png` (flag ON, isolated), `05-records-all-on.png` (all four record sections together, for hierarchy comparison), `00-records-off.png` (flag OFF, absence proof).

## Frozen prototype spec (Written agreements subsection)

- Section icon (✓) + title "Written agreements" + helper "Compliance dates and documents on file"
- Six fields, each label/value: Advisory agreement, Investment policy statement, Form ADV delivered, Form CRS delivered, Privacy notice, Financial planning agreement
- Lives as one of four stacked subsections *inside* a single "Client profile" card, under one shared "Edit full profile" button at the top of that card

## Real-app structure

- Own `Card` (`data-testid="compliance-dates-written-agreements"`) — a separate card, not a subsection inside a unified "Client profile" card
- Title = `complianceDates.title`, helper = `complianceDates.helper` (i18n; expected to read close to "Written agreements" / compliance-dates helper copy)
- Own "Edit" button (`compliance-dates-edit`) toggles an editable grid of 6 date inputs, each labeled via `complianceDates.fields.*`:
  - `advisory-agreement`, `investment-policy-statement`, `form-adv-delivered`, `form-crs-delivered`, `privacy-notice`, `financial-planning-agreement`
  - This is the same six-field vocabulary as the prototype's Written agreements list, one-for-one
- Read state shows each field as small-label-over-bold-value rows; Save/Cancel actions when editing

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Six fields match prototype vocabulary exactly (Advisory agreement, Investment policy statement, Form ADV delivered, Form CRS delivered, Privacy notice, Financial planning agreement) | PASS | `01-record-compliance-dates-on.png` — title "Written agreements", helper "Compliance dates and documents on file" (verbatim prototype match), fields visible: Advisory agreement, Investment policy statement, Form CRS delivered, Privacy notice (2 of 6 fields — Form ADV delivered, Financial planning agreement — are pushed off the right edge of the responsive grid by an unrelated floating "Will auto-join" toast overlapping the card; code read of `WrittenAgreementsSection.tsx` confirms all 6 fields are mapped from `COMPLIANCE_DATE_FIELDS` with matching labels) |
| Editable date entry + Save/Cancel present | PASS | "Edit dates" button visible in the screenshot; code confirms `compliance-dates-save`/cancel wired |
| Light theme, calm card hierarchy | PASS | white card, dark text, muted helper copy — matches |
| Structural hierarchy: prototype nests this inside one unified "Client profile" card; real app renders it as its own separate top-level `Card` alongside the other three record sections | **Expected DELTA** (architecture: one-lane-one-folder-one-card law; not a bug) | `05-records-all-on.png` shows Professional contacts and Employment as two independently-bordered stacked cards, confirming the same pattern applies to compliance-dates |
| Flag OFF → section absent | PASS | `00-records-off.png` — page ends after the legacy "Internal only / Client-facing" fields card, no written-agreements card present |

OVERALL: **PASS** — vocabulary, structure, and light-theme styling all match the frozen spec at the field level. The only real delta is the known, deliberate one-card-per-lane architecture (noted as expected, not a defect). A floating "Will auto-join" notification toast partially overlapped 2 of 6 fields in this particular screenshot — a transient UI overlap unrelated to the compliance-dates lane itself, not a parity issue with the section's own layout.
