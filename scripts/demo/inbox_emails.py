"""Shared data: realistic client emails for Sarah Morgan's demo inbox.
Used by both populate-inbox.py (IMAP APPEND, when the new-account IMAP lock lifts) and
brevo_send.py (send real mail via Brevo from a verified domain — works immediately).
Tuple: (from_name, client_addr, subject, days_ago, unread, body)"""

EMAILS = [
 ("Thomas Brennan","tbrennan.mail@gmail.com","Roth conversion before year-end?",2,True,
  "Hi Sarah,\n\nKaren and I have been thinking about the Roth conversion strategy you mentioned at our last review. We'd like to move forward with converting a chunk of my Traditional IRA this year while we're in a lower bracket after the business sale.\n\nMy main question: how much can we convert in 2026 without pushing us into the next tax bracket? We want to be aggressive but not reckless. Also, should we wait until December once we know our full income picture?\n\nOne more thing - the $200k of Cascade Climate preferred shares come out of lock-up in July. Does that change the timing?\n\nThanks,\nThomas"),
 ("Priya Patel","priya.patel82@gmail.com","RSU vesting next month - what to do?",5,True,
  "Sarah,\n\nMy next big RSU tranche vests March 15th, roughly $180,000 worth of company stock. After this, company stock will be close to 40% of my net worth, which I know you've flagged as too concentrated.\n\nCan we set up a plan to sell down systematically? I'm nervous about the tax hit but more nervous about having all my eggs in one basket. What's the smartest way to diversify without a huge capital gains bill all at once?\n\nPriya"),
 ("Eleanor Voss","eleanor.voss1948@outlook.com","RMD and charitable giving question",8,False,
  "Dear Sarah,\n\nNow that I'm 78, my required minimum distribution is larger than I need for living expenses. My accountant mentioned something called a QCD - giving directly to charity from my IRA to avoid the tax.\n\nI'd like to give $25,000 to the Cedar Falls Community Foundation this year. Can we do that as a qualified charitable distribution straight from my IRA? Would that count toward my RMD?\n\nWarm regards,\nEleanor Voss"),
 ("Robert Ellison","rellison.home@gmail.com","Beneficiary update - new grandchild",11,False,
  "Hi Sarah,\n\nWonderful news - our daughter had a baby girl last week, our first grandchild! Margaret and I want to make sure she's included in our estate plan.\n\nCan we review our beneficiary designations and the trust? We'd like to set aside something for her education. Let me know what you need from us.\n\nBest,\nRobert Ellison"),
 ("David Nakamura","david.nakamura.fam@gmail.com","529 plans for the kids",14,False,
  "Sarah,\n\nSusan and I want to get serious about college savings for Mia (8) and Kai (5). We can put aside about $1,500/month combined.\n\nQuestions: Should we use a 529 plan? Is the Utah my529 plan still the one you recommended? And does it make sense to front-load five years of gifting into each account?\n\nThanks for your help,\nDavid"),
 ("Jennifer Caldwell","jen.caldwell.cf@gmail.com","Can I retire at 60?",17,True,
  "Hi Sarah,\n\nI've been running the numbers in my head and I keep going back and forth. I'll be 60 next year. Can I actually afford to retire then, or do I need to work to 65?\n\nMy biggest worries are health insurance before Medicare and whether my portfolio can handle 30+ years of withdrawals. Can we model a few scenarios at our next meeting?\n\nJennifer"),
 ("Marcus Webb","marcus.webb.t@gmail.com","Inheritance - where to put it",21,False,
  "Sarah,\n\nTanya and I just received about $320,000 from her late father's estate. It's sitting in a savings account doing nothing.\n\nWe don't need it for day-to-day expenses. What should we do with it? Pay down the mortgage, invest it, set some aside for the kids? We'd love your guidance before we do anything rash.\n\nMarcus Webb"),
 ("Carol Greer","carol.greer.home@outlook.com","Worried about the market",24,True,
  "Sarah,\n\nThe headlines have me anxious. Anthony keeps telling me to ignore the noise but I can't help worrying about our retirement accounts with everything going on.\n\nAre we positioned okay if there's a downturn? I'd feel a lot better after a quick call. Sorry to be that client!\n\nCarol"),
 ("Linda Koch","linda.koch.utah@gmail.com","Social Security timing",28,False,
  "Hi Sarah,\n\nPaul and I are trying to decide when to claim Social Security. He's 64, I'm 62. Our friends all have different opinions - claim early, wait until 70, etc.\n\nGiven our situation and the IRA balances, what's the optimal claiming strategy for us as a couple? Is it worth one of us delaying to 70?\n\nThank you,\nLinda Koch"),
 ("Deborah Mercer","deborah.mercer.r@gmail.com","Long-term care insurance?",33,False,
  "Sarah,\n\nA friend of mine just went through a difficult situation with her mother's care costs, and it got Ruth and me thinking. Should we be looking at long-term care insurance at our age, or is it too late / too expensive?\n\nIs there a smarter way to self-insure for this given our assets? Would value your perspective.\n\nDeborah"),
 ("Gary York","gary.york.rentals@gmail.com","Selling the rental - tax hit?",37,False,
  "Sarah,\n\nDeborah and I are thinking about selling the rental property on Maple Street. We've owned it 18 years and the gain would be substantial.\n\nWhat are we looking at tax-wise? Someone mentioned a 1031 exchange but we're not sure we want another property. Could we offset the gain somehow? Let's discuss.\n\nGary"),
 ("Angela Lambert","angela.lambert.biz@gmail.com","Starting my consulting business - retirement account?",41,False,
  "Hi Sarah,\n\nBig news - I'm leaving my job to start my own consulting practice! Exciting and terrifying.\n\nAs a self-employed person, what retirement account should I set up? I've heard about SEP-IRAs and Solo 401(k)s but don't understand the difference. I'd like to keep saving aggressively. Can you advise?\n\nAngela"),
 ("Jeffrey Pruitt","jeff.pruitt.k@gmail.com","Gifting to the kids",46,False,
  "Sarah,\n\nKimberly and I want to start gifting to our three children while we're alive to see them enjoy it. How much can we give each of them per year without tax consequences?\n\nWe're also curious whether we should fund 529s for the grandkids instead. What do you recommend?\n\nJeff"),
 ("Hollings Family Office","admin@hollingsfamily.net","Annual review - scheduling",52,False,
  "Hi Sarah,\n\nIt's about time for our annual portfolio review. Could you propose a few dates in the next month? We'd like to cover the IPS, the recent rebalancing, and the philanthropic plan for this year.\n\nAlso please send the updated performance report ahead of time so we can review.\n\nThank you,\nThe Hollings Family Office"),
 ("Susan Nakamura","susan.nakamura.fam@gmail.com","Quick question on the HSA",58,False,
  "Sarah,\n\nQuick one - we maxed out our HSA again this year. You mentioned we could invest the balance rather than leave it in cash. How do we do that, and what should we invest it in given we probably won't touch it for 20 years?\n\nSusan"),

 # Beacon Ridge sample workspace: The Hendersons
 ("Robert Henderson","robert.henderson.demo@gmail.com","RMD timing before our January review",3,True,
  "Hi Sarah,\n\nI saw the note in the Fidelity packet that my first required minimum distribution starts because I turn 73 this year. Linda and I are wondering if we should take the RMD in December 2026 instead of waiting until the April 1 deadline in 2027.\n\nCan you show us how that affects Medicare IRMAA and whether 15% federal withholding is still enough? We would like to talk through it at our January 15 meeting.\n\nThanks,\nRobert"),
 ("Linda Henderson","linda.henderson.demo@gmail.com","Beneficiary update for Ethan's 529",6,False,
  "Hi Sarah,\n\nBefore we open Ethan's 529, can we confirm how the successor owner should be listed? Robert and I want our daughter Megan to manage the account if something happens to us, but we do not want to accidentally change the gift-tax plan you outlined.\n\nAlso, please remind us what information you need from Megan before the forms are ready.\n\nLinda"),
 ("Robert Henderson","robert.henderson.demo@gmail.com","Follow-up from the Sarasota downsizing call",10,False,
  "Sarah,\n\nThanks for walking us through the downsizing plan. We spoke with Coastal Realty Group and still think a Q2 2027 listing is realistic.\n\nPlease add a note that any net proceeds should go into the joint brokerage account as the health care and long-term-care reserve we discussed.\n\nRobert"),
 ("Linda Henderson","linda.henderson.demo@gmail.com","Question on the 529 lump sum",15,False,
  "Hi Sarah,\n\nIf we split the $80,000 529 contribution into two deposits, one now and one later this year, does the five-year gift election still work the same way on Form 709?\n\nWe are comfortable funding it from the Schwab joint account, but I want to understand the paperwork before we move the money.\n\nLinda"),

 # Beacon Ridge sample workspace: Maria & Luis Alvarez
 ("Maria Alvarez","maria.alvarez.demo@gmail.com","Roth conversion amount for 2026",4,True,
  "Sarah,\n\nLuis and I want to move ahead with the 2026 Roth conversion from his SEP IRA. Your plan mentioned $40,000, split into two $20,000 pieces in April and October.\n\nCan you confirm that still keeps us inside the 22% bracket after the taqueria remodel costs and the Q1 estimated tax payment?\n\nMaria"),
 ("Luis Alvarez","luis.alvarez.demo@gmail.com","Business sale offer - too early?",9,False,
  "Hi Sarah,\n\nWe received another informal offer for Alvarez Family Taquerias, this time from a regional restaurant group. It is not close to the $3 million target, but it made us wonder what we should have ready before a serious buyer appears.\n\nCan we add this to the February meeting agenda with the Meridian appraisal?\n\nLuis"),
 ("Maria Alvarez","maria.alvarez.demo@gmail.com","Diego's 529 and trade school",13,False,
  "Sarah,\n\nDiego keeps asking whether his 529 can be used for culinary school or another trade program instead of a four-year college. I know you said most accredited programs count, but could you send us the short version before we talk with him?\n\nThanks,\nMaria"),
 ("Luis Alvarez","luis.alvarez.demo@gmail.com","Meeting follow-up: tax-loss harvesting",18,False,
  "Sarah,\n\nAfter our review, please send the next steps for the energy ETF and regional bank ETF losses in the Schwab account. If harvesting those losses helps offset part of the Roth conversion income, we would like to do it before the window closes.\n\nLuis"),

 # Beacon Ridge sample workspace: Dr. Priya Nair
 ("Priya Nair","priya.nair.demo@gmail.com","Backdoor Roth after new contract",2,True,
  "Sarah,\n\nI signed the new Cascade Regional contract, so my base salary moves to $460,000 in July. Does that change anything about the backdoor Roth IRA contribution and conversion for 2026?\n\nI remember you said the strategy still works because I do not have any pre-tax IRA balance, but I would like to double-check before I fund it.\n\nPriya"),
 ("Priya Nair","priya.nair.demo@gmail.com","Beneficiary designations for my accounts",7,False,
  "Hi Sarah,\n\nSince I am single and do not have dependents, I want to make sure my sister Anika is listed correctly on the Fidelity 403(b), Roth IRA, and taxable TOD paperwork.\n\nCan we review beneficiary designations during the March 3 meeting and note anything that needs an estate attorney?\n\nPriya"),
 ("Priya Nair","priya.nair.demo@gmail.com","PSLF form follow-up",12,False,
  "Sarah,\n\nHR says they can sign my annual PSLF employment certification next week. I should be at 84 qualifying payments through December 2025, with forgiveness still projected in 2029.\n\nPlease remind me if you need a copy of the signed form for the file.\n\nPriya"),
 ("Priya Nair","priya.nair.demo@gmail.com","Disability coverage quote",16,False,
  "Hi Sarah,\n\nGuardian sent the updated quote to increase my own-occupation disability coverage from $12,000 per month to $15,000 per month. The premium is higher than I expected, but I understand why it matters for interventional cardiology.\n\nCan we compare this with the home down payment goal before I decide?\n\nPriya"),
]
