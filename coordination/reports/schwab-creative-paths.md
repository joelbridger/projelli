s/individual-developer/about-individual-developer-role
- https://developer.schwab.com/user-guides/get-started/authenticate-with-oauth
- https://advisorservices.schwab.com/managing-your-business/tech-integration/api-integration
**2. Account Aggregation Read Path**
This is the best “without Schwab partner approval” path.
How it works:
- Client chooses “Connect Schwab.”
- Client logs in through a trusted aggregator flow.
- App receives read-only normalized data: accounts, balances, holdings, transactions, sometimes tax lots.
- Advisor Prep Hero stores/summarizes it locally for prep.
Provider read:
- **Plaid: strong candidate.** Plaid Investments supports balances, holdings, and transactions. Plaid docs/changelog specifically reference Charles Schwab OAuth access.
  Sources: https://plaid.com/products/investments/ and https://plaid.com/docs/changelog/
- **Yodlee: strong candidate.** Schwab announced a data-access agreement with Envestnet/Yodlee. Yodlee has holdings and account aggregation APIs.
  Sources: https://www.prnewswire.com/news-releases/envestnet--yodlee-and-charles-schwab-enter-financial-data-access-agreement-301041811.html and https://developer.yodlee.com/resources/yodlee/data-model/docs/holdings
- **Morningstar ByAllAccounts: strong advisor/wealth candidate.** It aggregates financial accounts, positions, transactions, prices, securities, and tax lots. It has Schwab-specific open banking and institutional SFTP setup docs.
  Sources: https://www.morningstar.com/en-us/business/products/byallaccounts and https://developers.byallaccounts.morningstar.com/docs/open_banking_sources and https://developers.byallaccounts.morningstar.com/docs/charles-schwab-institutional-sftp
- **MX: plausible, verify with vendor.** MX markets account aggregation and investment data, but I did not find a clean public Schwab-specific support page like Plaid/Yodlee/ByAllAccounts.
  Sources: https://www.mx.com/products/account-aggregation/ and https://www.mx.com/products/investment-data/
- **Akoya: plausible but verify.** Akoya is a 100% API-connected permissioned data network. I did not find a public Schwab-specific provider listing, but Schwab says it uses tokenized, FDX-aligned third-party data-access terms.
  Sources: https://akoya.com/ and https://www.schwab.com/legal/public-security-tips-popup
Main risk:
- Aggregator data can be delayed, incomplete, or lose authorization.
- Some providers need sales approval or production access approval.
- Advisor app must handle client consent, privacy notices, vendor due diligence, and revocation cleanly.
**3. Prefilled PDFs + Schwab/DocuSign**
This is a very legitimate workaround for account opening.
How it works:
- Advisor Prep Hero gathers client facts locally.
- It fills the official Schwab forms or creates a “review-ready packet.”
- Advisor reviews.
- Client signs through Schwab’s approved path: Schwab Advisor Center DocuSign, Schwab Digital Onboarding, wet signature, or whatever Schwab says is eligible.
Public forms exist:
- Schwab has a public Forms & Applications area.
- The Schwab One Brokerage Account page says “Apply online or use this form.”
- Many Schwab PDFs are public and fillable or can be filled as PDFs.
Key compliance point:
- Do **not** submit with our own DocuSign unless Schwab allows that firm to do it.
- Older Schwab FAQ says forms eSigned outside Schwab’s DocuSign tool may not be accepted unless the firm is approved.
- Schwab’s quick guide explicitly starts with “complete the forms… save as PDF,” then send through Schwab Advisor Center’s DocuSign.
Feasibility:
- **High.**
- This is not “we open the account.”
- It is “we make the advisor’s official Schwab paperwork much faster and cleaner.”
Sources:
- https://www.schwab.com/forms-and-applications
- https://www.schwab.com/resource/open-a-schwab-one-brokerage-account
- https://content.schwab.com/clientexperience/pdf/ESignature_Quickguide_Final.pdf
- https://content.schwab.com/clientexperience/pdf/CS-4486_CET_FAQ_Forms_v2.pdf
- https://advisorservices.schwab.com/whats-new/account-management/digital-onboarding
**4. Deep-Link / URL-Prefill Into Schwab DAO**
I found evidence of prefill, but not evidence of public URL-query prefill.
What competitors do:
- Wealthbox, Redtail, AdvisorEngine, Orion, Advyzon, Practifi, etc. pass client data into Schwab Digital Account Opening through formal Schwab/OpenView integrations.
- Public docs describe “send contact details to Schwab Advisor Center” and pre-populated digital envelopes.
- That is not just a simple URL with query params.
Feasibility without partnership:
- **Low for true prefill.**
- **Medium for a safe handoff helper:** open Schwab Digital Onboarding, show a local checklist, provide copy buttons, and generate the Schwab-ready data packet. Human stays in control.
Sources:
- https://www.wealthbox.com/digital-account-openings-with-schwab-advisor-center/
- https://help.wealthbox.com/hc/en-us/articles/29980352237851-Schwab-Digital-Account-Opening-integration
- https://support.advisorengine.com/portal/en/kb/articles/5020010004
- https://support.redtailtechnology.com/s/article/Schwab-Advisor-Center-Digital-Account-Opening
- https://advisorservices.schwab.com/serving-your-clients/acct-mgmnt-trading/account-management/digital-client-onboarding
**5. MoneyLink / ACH / Schwab Alliance**
This is useful after account opening.
How it works:
- Schwab MoneyLink is Schwab’s ACH service for moving money between Schwab and an external bank.
- Schwab Digital Onboarding can include funding.
- Schwab Alliance lets clients approve requests and fund transfers.
- Advisor Prep Hero can prepare ACH details, explain missing items, prefill forms, and guide the client to Schwab’s own approval flow.
Feasibility:
- **Good as a helper.**
- **Not a way to open accounts.**
- Do not initiate money movement directly unless using an official Schwab advisor workflow.
Sources:
- https://www.schwab.com/legal/schwab-moneylink-terms-and-conditions
- https://advisorservices.schwab.com/whats-new/account-management/move-money
- https://advisorservices.schwab.com/content/eauthorization-with-schwab-alliance-simple-fast-secure
- https://advisorservices.schwab.com/serving-your-clients/resources
**6. Competitor Pattern**
Competitors mostly are not bypassing Schwab.
- **Jump**: says Schwab connects through secure OAuth and includes custodian data, alerts, workflow status, beneficiary info. Help docs say Schwab admin permission and Data Delivery Enrollment are needed.
  Sources: https://jump.ai/integrations/schwab and https://help.jumpapp.com/en/articles/13909979-schwab-integration
- **Wealthbox**: formal Schwab/OpenView integration, SSO, account details, positions, transactions, Digital Account Opening prefill.
  Source: https://www.wealthbox.com/integrations/charles-schwab/
- **Redtail**: Schwab OpenView Gateway, daily account feed, SSO, Digital Account Opening.
  Source: https://advisorservices.schwab.com/provider-solutions/Redtail-CRM
- **RightCapital**: has both Schwab API and file-based Schwab setup. It recommends file-based for stability and says setup usually takes 3-5 business days after Schwab data-access paperwork.
  Source: https://help.rightcapital.com/integrations/asset-custodians/charles-schwab
**Start Here Recommendation**
Build three layers:
1. **Schwab Data Connect**
Use Plaid first, then test Yodlee/ByAllAccounts for richer advisor data. Pull holdings, balances, transactions, and positions with client consent.
2. **Schwab Prep Packet**
Generate prefilled Schwab PDFs/checklists locally. Include “advisor must review” and “client must sign through Schwab-approved path.”
3. **Schwab Handoff Mode**
Open the right Schwab page and show a clean copy/checklist panel. Do not scrape, auto-submit, or pretend to be an approved Schwab DAO integration.
That gives Advisor Prep Hero a real Schwab story now:
“Connect Schwab data with client permission, prepare the account-opening packet, and hand off to Schwab’s own approval flow.”