# Sonnet vision checklist — record-investment-profile

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `advisorProfileSections()` (Investment profile subsection).

Real app: `InvestmentProfileSection` at `src/features/crm-clients/extensions/investment-profile/InvestmentProfileSection.tsx`, mounted by `investmentProfileSection`, `tab: 'client_map'`. The lane's own earlier isolated-harness checklist (`src/features/crm-clients/extensions/investment-profile/evidence/sonnet-vision-checklist.txt`) already found PASS on this exact vocabulary; this batch checklist independently re-verifies in the real merged app.

Screenshot(s): `03-record-investment-profile-on.png` (flag ON, isolated), `05-records-all-on.png` (hierarchy), `00-records-off.png` (absence).

## Frozen prototype spec (Investment profile subsection)

- Icon (◇) + title "Investment profile" + helper "Planning horizon and risk preferences"
- Fields: Investment objective (Growth/Income/Preservation), Risk tolerance (Conservative/Moderate/Aggressive), Time horizon (0-3 / 3-10 / 10+ years), Liquidity need (free text)

## Real-app structure

- Own `Card` (`investment-profile-section`), title/helper via i18n
- `INVESTMENT_OBJECTIVES = [growth, income, preservation]`, `RISK_TOLERANCES = [conservative, moderate, aggressive]`, `TIME_HORIZONS = [under-3-years, 3-to-10-years, over-10-years]` — exact vocabulary match with the prototype
- Liquidity need is a free-text input, matching the prototype
- Save action with loading/error/conflict states (a real-time save-conflict guard not present in the static prototype — additive robustness, not a visual mismatch)

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Investment objective options match (Growth/Income/Preservation) | PASS | `03-record-investment-profile-on.png` — "Investment objective" select present, code confirms `INVESTMENT_OBJECTIVES = [growth, income, preservation]` |
| Risk tolerance options match (Conservative/Moderate/Aggressive) | PASS | "Risk tolerance" select present, code confirms `RISK_TOLERANCES = [conservative, moderate, aggressive]` |
| Time horizon options match (0-3/3-10/10+ years) | PASS | "Time horizon" select present, code confirms `TIME_HORIZONS = [under-3-years, 3-to-10-years, over-10-years]` |
| Liquidity need free-text field present | PASS | "Liquidity need" field with placeholder text visible |
| Light theme, calm card hierarchy | PASS | title "Investment profile", helper "Planning horizon and risk preferences" (verbatim prototype match) |
| Structural hierarchy: separate top-level card vs. prototype's nested subsection | **Expected DELTA** (see compliance-dates checklist rationale) | `05-records-all-on.png` |
| Flag OFF → section absent | PASS | `00-records-off.png` |

OVERALL: **PASS** — this independently reconfirms the lane's own prior isolated-harness checklist finding. Title, helper, and all four fields/option vocabularies match the frozen spec exactly in the real merged app, not just an isolated harness.
