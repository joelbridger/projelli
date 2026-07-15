# Sonnet vision checklist — record-professional-contacts

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `advisorProfileSections()` (Professional contacts subsection).

Real app: `ProfessionalContactsSection` at `src/features/crm-clients/extensions/professional-contacts/ProfessionalContactsSection.tsx`, mounted by `professionalContactsSection` (`registry.tsx`), `tab: 'client_map'`.

Screenshot(s): `04-record-professional-contacts-on.png` (flag ON, isolated), `05-records-all-on.png` (hierarchy), `00-records-off.png` (absence).

## Frozen prototype spec (Professional contacts subsection)

- Icon (◎) + title "Professional contacts" + helper "People involved in the client's financial life"
- Rows: FINRA trusted contact, CPA, Estate attorney, Insurance professional ("Not set · + Add inline" when empty)

## Real-app structure

- Own `Card` (`professional-contacts-section`), `ShieldCheck` icon + title/helper via i18n
- Four contact kinds: `trusted_contact`, `cpa`, `estate_attorney`, `insurance_professional` — a one-for-one match with the prototype's four rows
- Each row shows a summary (name · relationship · organization) when set, or an empty-state copy + "Add" button when not; "Edit"/"Add" opens an inline editor with name/relationship/organization/email/phone/notes fields and Save/Cancel

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Four contact rows match prototype vocabulary (trusted contact, CPA, estate attorney, insurance professional) | PASS | `04-record-professional-contacts-on.png` — "FINRA trusted contact", "CPA", "Estate attorney", "Insurance professional" all visible in that order |
| Empty-state "not set" + add affordance matches prototype's "Not set · + Add inline" | PASS | each row shows "Not set. Add a/the ..." copy + an "Add inline" button — same concept, slightly more descriptive empty-state copy than the prototype's terser "Not set · + Add inline" |
| Editable name/relationship/organization/email/phone/notes fields present | PASS (by code read) | not directly screenshotted mid-edit in this pass, but `ProfessionalContactsSection.tsx` confirms all six fields wired with Save/Cancel |
| Light theme, calm card hierarchy | PASS | title "Professional contacts", helper "People involved in this client's financial life" (near-verbatim prototype match) |
| Structural hierarchy: separate top-level card vs. prototype's nested subsection | **Expected DELTA** (see compliance-dates checklist rationale) | `05-records-all-on.png` shows this as its own bordered card |
| Minor layout note: the section's title/helper text sit slightly indented relative to compliance-dates/employment/investment-profile's flush-left headings | **Minor DELTA** | visible in `04-record-professional-contacts-on.png` — likely the `ShieldCheck` icon's flex gap rendering close to the card's left edge; cosmetic only, does not hide or block any control |
| Flag OFF → section absent | PASS | `00-records-off.png` |

OVERALL: **PASS** — vocabulary and empty-state affordances match the frozen spec. One minor cosmetic indentation note that doesn't affect usability, plus the same expected one-card-per-lane structural delta as the other three record sections.
