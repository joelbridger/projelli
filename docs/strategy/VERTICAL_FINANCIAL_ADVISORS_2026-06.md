# Financial Advisors: vertical foundation

**Date:** 2026-06-02 · Compiled by Claude (operator) for Jameson, from adversarially-verified deep research (25 claims, 3-0 verified, primary SEC/CFR/FINRA sources). Companion to the legal (ABA Op 512) and tax (IRC §7216) framing.

> **This is a research foundation, not legal advice and not marketing-approved copy.** Every regulatory-*applicability* claim below is well-sourced. But the specific marketing assertions about what Advisor Prep Hero's architecture "satisfies" must be reviewed by a securities-compliance attorney or compliance professional before they go on a page (see §5). We treat this exactly like the legal pack: do not market the claims until a practitioner signs off. Journey Beyond Wealth is our intended first reviewer.

---

## 1. The honest one-paragraph positioning

Financial advisors handle some of the most sensitive data there is, and the SEC has tightened the rules on exactly that. A local-first, bring-your-own-key workspace helps with the *data path*: it keeps client information on the advisor's own machine with no Advisor Prep Hero server in the middle, which directly supports the service-provider-oversight, access-control, and safeguards obligations the SEC now imposes, and it shrinks the breach-notification attack surface. What it does **not** do is make an advisor "compliant" or remove their duties. The retention, written-policy, and supervision obligations remain, and if the advisor uses a cloud AI model, that provider still sees the prompt. So the true pitch is narrow and strong: **Advisor Prep Hero keeps client data out of a vendor's hands and on your machine; it reduces your compliance surface, it does not erase it.**

---

## 2. The regulatory landscape (sourced)

**Regulation S-P, 2024 amendments (the safeguards rule).** Apply to "covered institutions," which explicitly includes **SEC-registered investment advisers**. They require: a written **incident-response program** (detect, respond, recover); **harm-based breach notification** to affected individuals "as soon as practicable but no later than 30 days" (17 CFR 248.30(a)(4), gated by the defined term "sensitive customer information," with a harm-based exception and an encryption safe harbor); and **written oversight, due diligence, and monitoring of service providers**. Tiered compliance: effective Aug 2, 2024; larger entities by **Dec 3, 2025**, smaller by **June 3, 2026** (which has just passed, so solo/small RIAs are at or past their deadline). Sources: SEC press release 2024-58, final rule 34-100155, SEC Small-Entity Compliance Guide, FINRA cybersecurity advisory, Cornell LII 17 CFR 248.30.

> **The central value lever:** a third-party AI vendor that receives client information is a "service provider" subject to that written oversight/due-diligence duty. A local-first, no-vendor-server architecture **reduces or removes the service-provider-oversight burden for the data path itself**, because there is no vendor in the path to diligence. (This is a sound interpretive reading of the rule, not verbatim rule text. Flag for counsel.)

**Books-and-records rule (17 CFR 275.204-2).** Advisers must retain originals of written communications received and copies sent relating to recommendations/advice, for **not less than five years** (first two in the office), with electronic-storage **data-integrity and access controls** (204-2(g)(3): safeguard from loss/alteration, limit access to authorized personnel + the SEC, ensure complete/true/legible reproductions). The rule is **medium-neutral**: AI-assisted memos and client communications that are **transmitted** fall within it (Skadden, Sept 2024). Two honest limits: (a) AI output that is merely stored and never transmitted is likely **not** automatically a record; (b) the retention duty is **on the adviser**, and a local-first tool does **not** discharge it. Note: the SEC **declined to require WORM** storage for advisers (unlike broker-dealers under 17a-4), so we must not claim WORM. Sources: Cornell LII / eCFR 17 CFR 275.204-2, Skadden, Kitces, MoFo.

**SEC posture on AI.** The SEC brought its **first "AI washing" enforcement** on March 18, 2024 against two advisers (Delphia, Global Predictions), **$400K** total, under the **Marketing Rule (17 CFR 275.206(4)-1)** and Compliance Rule. Chair Gensler: "Investment advisers should not mislead the public by saying they are using an AI model when they are not." The **predictive-data-analytics conflicts proposal (S7-12-23) was formally withdrawn** June 17, 2025; the SEC "does not intend to issue final rules" and would need a new proposed rule to revive it. So there is **no current PDA-specific AI rule**, but the general fiduciary, Marketing Rule, and Reg S-P duties remain fully in force. Sources: SEC 2024-36, Gensler statement, Federal Register 2025-11110 / SEC 33-11377.

> **What this means for OUR marketing:** the AI-washing actions are about advisers overstating their AI. The same Marketing Rule logic is why **we** must describe Advisor Prep Hero's AI precisely and never imply it makes investment decisions or guarantees compliance. Overclaiming is the exact thing the SEC is fining people for.

---

## 3. What we CAN say (the honest value proposition)

- "Your client data stays on **your** machine. There is **no Advisor Prep Hero server** in the path between you and the AI." (True.)
- "Because there's no vendor holding your client data, there's less for you to diligence and monitor under the service-provider-oversight expectations of the 2024 Reg S-P amendments, and a smaller surface to worry about in a breach." (True, framed as support not guarantee.)
- "You bring your own AI key, so the connection goes straight from your computer to the provider you chose, under the terms you agreed to with them." (True.)
- "Every chat becomes a real file in a folder you control, so your work product is yours to retain and produce." (True, and it *supports* the 5-year retention duty without claiming to satisfy it.)
- "Advisor Prep Hero reduces your compliance surface. It does not replace your policies, your retention, or your judgment." (True, and it's the honest frame that builds trust with a compliance-minded buyer.)

---

## 4. What we must NOT say (hard do-not-overclaim list)

1. **Never "compliant" / "Reg S-P compliant" / "SEC-approved."** Advisor Prep Hero is a tool; compliance is the advisor's, and it depends on their whole program.
2. **Never "your data never leaves your machine" without the cloud-model caveat.** With a bring-your-own-key *cloud* model, the **provider still sees the prompt content**. "Data never leaves" is only literally true for a **fully local (Ollama) model.** Always distinguish "no Advisor Prep Hero vendor server in the path" (true) from "no third party ever sees your data" (false when a cloud API is used).
3. **Never imply we satisfy the 5-year retention or the 204-2(g) safeguards.** Those stay on the advisor; we *support* them.
4. **Never claim WORM / non-rewriteable storage.** Not required for advisers, and we don't provide it.
5. **Say "SEC-registered RIAs"** when citing Reg S-P. State-registered advisers and exempt reporting advisers are outside SEC Reg S-P and may face the **FTC Safeguards Rule** or state law instead. Many solo/small CFPs are state-registered (see open gap §6).
6. **Present the 30-day breach duty with its qualifiers** ("sensitive customer information," harm exception, encryption safe harbor), never as an unconditional duty for any access to any client data.
7. **Flag interpretive inferences as ours.** "An AI vendor is a service provider subject to oversight" and "these duties persist regardless of where AI runs" are sound readings, not rule text. Present as our view, vetted by counsel.
8. **Never imply AI makes or informs investment decisions.** That's the AI-washing / fiduciary minefield. Advisor Prep Hero is a writing/organizing workspace.

---

## 5. Claims to verify with a securities-compliance attorney before marketing

- That a no-vendor-server, local-first architecture meaningfully **reduces the service-provider-oversight burden** under amended Reg S-P (our central lever).
- That keeping AI work as local files **supports** (without satisfying) the 204-2 retention and 204-2(g) safeguards duties.
- The precise, defensible wording for "reduces your compliance surface" so it can't be read as "makes you compliant."
- Whether/how to reference the **custody rule (206(4)-2)** and **Reg BI** in advisor data-handling copy (currently under-evidenced; see §6).
- The correct scoping language for **state-registered vs SEC-registered** advisers and the **FTC Safeguards Rule**.

---

## 6. Open research gaps to close before launch

1. **The AI providers' actual data-handling terms** (retention, training-on-prompts, zero-data-retention options for Anthropic/OpenAI/etc.). This is the single most load-bearing unverified fact behind the "provider still sees prompts" framing. Confirm before any "data" claim ships.
2. **Custody rule + Reg BI as they bear on client-DATA handling** specifically. The research thoroughly covered Reg S-P, 204-2, the Marketing Rule, and the PDA withdrawal, but did not surface primary citations tying custody/Reg BI to *data* obligations. Research before using.
3. **State RIA regs + FTC Safeguards Rule.** Many solo/small CFP targets are state-registered, not SEC-registered, so the governing regime differs. Map this before vertical targeting.
4. **Current (post-June-2025) SEC enforcement appetite + any successor AI guidance** under new leadership. Re-verify near launch.

---

## 7. How this feeds the vertical

- **`/advisors/` (or `/financial-advisors/`) landing page:** built from §3, gated by §4, after a compliance review of §5. Same structure as `/legal-practice/` and `/tax-practice/`.
- **Advisor pack:** do NOT build on spec. Co-shape it with Journey Beyond Wealth (and any other advisor reviewer) per the design-partner play. Likely candidates to explore *with them*: client-meeting prep, meeting-notes-to-summary, financial-plan narrative drafting, annual-review prep, prospect discovery. Let the practitioner tell us, then build.
- **Reviewer:** JBW is the intended first reviewer + named reference for this vertical. The advisor review package (in `docs/marketing/campaigns/2026-06-reviewer-program/REVIEWER_KIT.md`) gets built from §3-§5 once we know the pack.
- **Honest wedge over the whole vertical:** local-first reduces the data-path compliance surface for a buyer the SEC has put squarely on notice (Reg S-P deadlines just passed, AI-washing enforcement live). That's a real, timely, true story. We just have to tell it without overclaiming, which is exactly what §4 enforces.

**Sources (primary):** SEC 2024-58, 34-100155, Small-Entity Guide, 2024-36, 33-11377; FINRA cybersecurity advisory; Cornell LII / eCFR 17 CFR 248.30, 275.204-2, 275.206(4)-1; Federal Register 2025-11110. Full verified claim set + secondary corroboration in the research output for run wf_53b06ca1-3fa.
