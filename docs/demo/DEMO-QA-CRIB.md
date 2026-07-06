# Demo Q&A Crib Sheet — Advisor Sample Workspace

**⚠️ Local AI working-memory constraint:** the on-device Local AI mode has a
small working-memory budget (~16k tokens). A long, multi-part question plus
the ~8 retrieved chunks Ask pulls in can overflow it and produce a truncated
or garbled answer. **Every question below is deliberately short, single-fact,
and answerable from ONE source file** — don't improvise longer or
multi-client questions on stage in Local AI mode. (BYOK/cloud provider modes
have much larger context windows and are more forgiving, but these short
questions work everywhere.)

Sample data: `docs/demo/sample-workspace/` — three fictional households at
the fictional firm **Beacon Ridge Wealth Advisors**. Generate/regenerate with
`python3 docs/demo/sample-workspace/generate_workspace.py`.

---

## The Hendersons (Robert & Linda)

| # | Ask this | Expected answer | Source file |
|---|---|---|---|
| 1 | When is Robert Henderson's first RMD due, and how much? | Due by **April 1, 2027**; projected at approximately **$50,566**. | `Fidelity IRA Statement Summary - Q4 2025.pdf` |
| 2 | How much are the Hendersons gifting to Ethan's 529 plan? | **$80,000** lump sum, using the 5-year gift-tax averaging election. | `Financial Plan Summary - Henderson.docx` |
| 3 | What is the Hendersons' target asset allocation? | **35% U.S. equity / 20% international equity / 40% fixed income / 5% cash.** | `IPS Excerpt - Henderson.docx` |

## Maria & Luis Alvarez

| # | Ask this | Expected answer | Source file |
|---|---|---|---|
| 1 | What is Alvarez Family Taquerias' appraised value? | Approximately **$2,100,000** (2025 appraisal by Meridian Business Valuations). | `Financial Plan Summary - Alvarez.docx` |
| 2 | How much is Luis converting to Roth each year? | **$40,000/year** for 2025, 2026, and 2027. | `Meeting Prep Notes - Alvarez - 2026-02-11.docx` |
| 3 | What is the Alvarez household's target equity allocation? | **50% U.S. equity + 25% international = 75% total equity** (growth-oriented). | `IPS Excerpt - Alvarez.docx` |

## Dr. Priya Nair

| # | Ask this | Expected answer | Source file |
|---|---|---|---|
| 1 | How much student loan debt does Dr. Nair have, and what's her payoff plan? | **$178,400**; pursuing PSLF, projected full forgiveness in **2029**. | `Financial Plan Summary - Nair.docx` |
| 2 | What disability insurance change are we discussing with Dr. Nair? | Increasing her Guardian policy from **$12,000/month to $15,000/month**. | `Meeting Prep Notes - Nair - 2026-03-03.docx` |
| 3 | What's Dr. Nair's target asset allocation? | **55% U.S. equity / 30% international / 10% fixed income / 5% cash** (aggressive growth). | `IPS Excerpt - Nair.docx` |

---

## Notes for whoever runs the demo

- These questions double as the **QA-92 regression check**: every source file
  above was written to disk *before* the app ever opened the workspace (via
  the generator script, not created inside the app), so a correct answer
  proves "Ask finds pre-existing files" is fixed.
- Each client folder also has a signed advisory agreement PDF
  (`Beacon Ridge Advisory Agreement - Signed.pdf`) with a fee schedule, in
  case a fee question comes up live.
- All content is 100% fictional. No real client data, no product
  brand/codename appears anywhere in the generated documents (verified by
  `generate_workspace.py`'s own leak check when it's re-run).
