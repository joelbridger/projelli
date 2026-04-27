# Acme Budget, First Hire Playbook, Full-Stack Engineer

## The decision

Acme Budget's first hire is a full-stack engineer with Plaid + TypeScript + Postgres experience. Not an iOS engineer, not a growth hire, not a product designer. The bottleneck today is my own engineering time, and SEO, customer support, and sales I can keep doing myself through $20K MRR.

## When I pull the trigger

When Acme Budget crosses $10K MRR for two consecutive months. At $10K MRR the business can cover a $7K/month contract rate with a 30% buffer.

## The job description

### Title

Founding Engineer, Acme Budget

### About us

Acme Budget is a personal finance app for US freelancers with variable income. We launched in Q2 2026 and are currently at $10K MRR with 850 paid users growing ~25% month-over-month. It's a single-founder company until you show up.

### The role

You'll own the backend and the Plaid integration end-to-end. The current code is TypeScript on a [Node.js](https://nodejs.org/) Fastify server, Postgres via [Supabase](https://supabase.com/), deployed on [Fly.io](https://fly.io/). The frontend is [Next.js](https://nextjs.org/) + [Tailwind](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/).

### What you'll actually do in the first 90 days

1. Take over primary on-call for Plaid webhook reliability
2. Ship multi-account support (currently max 4 accounts, needs 12)
3. Add state-tax handling for all 50 states (currently 7)
4. Reduce p95 API latency from 340ms to under 200ms

### Requirements

- 5+ years backend, 2+ years full-stack
- Production experience with Plaid or a similar banking API
- TypeScript strict mode fluent
- Comfortable with SQL, joins, indexes, transaction isolation levels
- Has shipped a financial product to real users at some point

### Nice to have

- iOS experience for the eventual mobile app
- Ex-Ramp / Brex / Mercury / Stripe / Plaid background
- A public portfolio of OSS work

### Compensation

$7,000/month as a 1099 contractor for 3 months. If both sides are happy, convert to W-2 at $180K base + 2% equity (4-year vest, 1-year cliff). No signing bonus.

## The interview rubric

Four stages, 4.5 hours total.

### Stage 1: 30-minute intro call

Goal: confirm mutual fit on basics.

Five questions:

1. Walk me through the most complex Plaid-integrated feature you've shipped.
2. Tell me about a production incident you owned.
3. What do you wish a tool like Acme Budget did better?
4. What are you optimizing for in your next role?
5. What would make this a terrible job for you?

If all five answers feel specific and real, move to stage 2.

### Stage 2: 90-minute paid code exercise

A real Plaid-webhook-idempotency bug from our codebase, with the actual failing test case. Paid at $200 for the 90 minutes regardless of outcome.

Rubric:

- Does the candidate ask the right clarifying questions? (3 points)
- Do they identify the race condition correctly? (3 points)
- Is the fix minimal and correct? (3 points)
- Are the new tests meaningful? (3 points)
- Is the code style consistent with ours? (2 points)

Pass threshold: 10 of 14 points.

### Stage 3: 90-minute system design

One question: design the state-tax handling for all 50 states, starting from our current 7-state implementation. I'm looking for how they think about data freshness, per-state idiosyncrasies (e.g., California's specific estimated-tax rules), and how they'd roll it out without breaking existing users.

### Stage 4: 30-minute founder chat

No coding. One open-ended conversation about working with me specifically: pace, async vs sync, feedback style, what Acme Budget looks like in 2 years. This is where I'm also giving them a realistic picture of weird solo-founder moments so they can self-select out if they should.

## The 30/60/90-day onboarding plan

### Days 1-14

- Read every open PR, every closed PR from the last 90 days, every Linear ticket in the current sprint
- Shadow on-call with me, Maya, for one full rotation
- Ship one tiny PR by end of week 2, even if it's a typo fix in a README

### Days 15-45

- Take primary on-call rotation
- Ship the first Plaid-adjacent feature end-to-end (likely multi-account support)
- Run one full weekly review with me where they present what they shipped

### Days 46-90

- Take over the state-tax rollout
- Present to advisors at the Q3 board meeting
- At day 90, we both write a one-page "how's this going" memo and exchange them on the same Friday

## The red flags I'm watching for during onboarding

1. Not asking clarifying questions before writing code
2. Wanting to rewrite things that aren't broken
3. Going silent for more than 24 hours without a "here's what I'm stuck on" note
4. Not being curious about the actual users

## The offer letter

[Gusto's contractor template](https://gusto.com/) with a one-page addendum on IP, confidentiality, and the convert-to-W2 trigger.
