# Acme Budget, Weekly Review, 2026-04-11

## What I said I'd do last week

1. Ship the Plaid webhook retry logic with idempotency keys.
2. Run 3 user interviews.
3. Draft the Sunday review email template.
4. File my own Q1 estimated taxes.

## What I actually did

- **Plaid webhook retry: done.** PR merged Wednesday. Tested across two simulated Plaid outages using their [sandbox environment](https://plaid.com/docs/sandbox/). 3 idempotency keys now guard every income-allocation event.
- **User interviews: 2 of 3 done.** The third person no-showed. Rescheduled for Tuesday.
- **Sunday review email: done.** First version went to 18 beta users last night. 12 opened, 4 replied with feedback within an hour. Two pieces of feedback were the same: "put the runway number at the top, not the bottom."
- **My own Q1 taxes: done.** Paid Friday via [EFTPS](https://www.eftps.gov/). $6,420, inside the estimate Acme Budget computed on March 1.

## What I didn't do

- Did not start the accountant partnership outreach. Punted to next week. No excuse.
- Did not reply to two newsletter editors who pitched me. Sitting in drafts. This is a pattern.

## The numbers this week

- Beta users: 42, up from 40
- Active (opened app in last 7 days): 36
- Tax set-aside total across all users: $41,200
- Paid users (friends-and-family tier only): 3
- MRR: $36

## The anomaly

One beta user's Plaid connection broke Tuesday and didn't reconnect until Thursday. They missed two income events. The Sunday email flagged the anomaly ("lower-than-usual income detected, check your connection") but the tone was too calm. Need to make the reconnection CTA more urgent.

## The decision I'm sitting on

Should Acme Budget's free trial require a credit card or not?

- **No card = more trials, lower conversion.** Industry benchmark via [Baremetrics](https://baremetrics.com/) data is ~22% trial-to-paid without card, ~45% with card.
- **Card required = fewer trials, higher conversion.** But I suspect my ICP (freelancers burned by surprise fees) is especially averse to giving a card for a 14-day trial.

Decision by next Sunday.

## Feedback I got this week that's worth capturing

1. "Make the tax number bigger." (2 users)
2. "Can I set a separate goal bucket for a house down payment?" (3 users)
3. "The quarterly reminder email is great. Can you also text me?" (1 user)
4. "I wish I could see profit-by-client." (4 users, this is becoming a theme)

## Focus for next week

1. Ship the layout change: runway number at the top of the Sunday email.
2. Finish 3 remaining user interviews (10 of 10).
3. Send accountant partnership outreach to 10 CPAs.
4. Reply to both newsletter editors.
5. Decide on the credit-card-for-trial question and write up the reasoning.

## One line for the investor update

Still at 42 beta users, MRR at $36, decision pending on trial card requirement, Q2 launch on track for week 12.
