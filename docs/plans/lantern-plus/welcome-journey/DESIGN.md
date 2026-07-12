# Welcome Journey Design Draft

## Purpose

This is the P7 layer of Lantern Intake: the client has said yes, but the next
part of the relationship still feels foggy, scattered, and paperwork-heavy.
The welcome journey turns that same secure intake link into a calm guide:

- what happens next
- who is who at the firm
- where the client is in the process
- what message the client should receive next

It is not a second product, not a client portal, and not a marketing site. It is
a hospitality layer on top of Lantern Intake. The same link collects sensitive
data, receives uploads, shows progress, and explains the relationship.

## Parent Rules

This design stays subordinate to Lantern Intake and inherits its rules:

- **One link.** The client never gets a separate welcome-site link, tracker link,
  portal link, or account invite.
- **No account.** The client opens the secure intake link, resumes with the same
  link, and sees the right state.
- **Mobile first.** Most clients will open the link from email or a text message.
- **Firm branded, light theme.** The experience feels like the advisor's firm,
  with Lantern invisible unless the firm chooses to show it.
- **Encrypted by the intake layer.** Welcome content can be public-ish, but it
  rides with the intake session. Anything client-specific stays inside the same
  encrypted intake record.
- **AI proposes, advisor approves.** Lantern may draft welcome and milestone
  emails, but it never sends them silently.
- **No new global work queue.** The onboarding board is for in-progress onboarding
  only. It is not a general task inbox.
- **No em dashes in client-visible copy.** Examples in this document use plain
  punctuation.

## The Product Shape

The welcome journey is the first thing the client sees after opening the intake
link, and it remains available throughout intake.

The default client page has three parts:

1. **Welcome header**
   - "Welcome, Mira"
   - firm logo
   - advisor name
   - one plain sentence about why this page exists
   - primary action: continue the secure checklist

2. **What happens next**
   - a simple timeline of onboarding milestones
   - the current milestone highlighted
   - plain explanations of what the firm is doing and what the client needs to do

3. **Your team**
   - the people the client may hear from
   - what each person helps with
   - how to contact the right person

The checklist remains the main job. The welcome content supports it. If the
client has missing items, the page opens on the next missing item and keeps the
timeline nearby as a small, expandable section.

## Client Experience

### 1. The client says yes

The advisor clicks **New client** in Lantern Intake, chooses the intake template,
makes any per-client changes, and sends the same secure intake link.

Lantern also drafts the first welcome email. The advisor sees it before it goes
out, edits if needed, and approves.

Client-visible example:

```text
Subject: Welcome to Oak Ridge Planning

Hi Mira,

We're glad you're here.

Your secure onboarding page is ready:
[Start your onboarding]

Inside, you'll see what we need from you, what happens after each step, and who
to contact if anything feels confusing.

First step: upload the front and back of your driver's license.

Thanks,
Lena
```

### 2. The client opens the link

The first screen should not feel like a form. It should feel like the firm has
prepared for them.

Client-visible page copy example:

```text
Welcome, Mira.

This is your secure onboarding page with Oak Ridge Planning. We'll use it to
collect the few things we need, show where you are in the process, and keep you
clear on what happens next.

Start with the first item below. You can come back to this page any time.
```

The page shows:

- **Your next step:** the first required intake item
- **Where you are:** highlighted milestone
- **Your team:** lead advisor plus support contacts
- **Need help?** one firm-chosen contact method

The design should avoid a long "before you begin" wall. The client should feel
oriented quickly.

### 3. The client works through the checklist

As the client completes intake items, the welcome layer responds:

- uploads and answers update the checklist
- the timeline highlights the next milestone
- the client sees why the next item matters
- "I don't know" paths stay available where Intake allows them

Example helper copy beside monthly spending:

```text
A rough answer is okay. We use this to start the planning conversation, not to
grade your budget.
```

When a client finishes a meaningful chunk, Lantern can draft a milestone email.
The advisor approves it before it sends.

Client-visible example:

```text
Subject: We received your first documents

Hi Mira,

Thank you. We received your license and income details.

Next, please add last month's spending estimate when you can. A rough answer is
fine.

After that, our team will review everything and prepare the account paperwork.

Thanks,
Lena
```

### 4. The client pauses and resumes

The same link always works. When the client returns, Lantern opens to the next
useful thing:

- if nothing is started, show the welcome page and first checklist item
- if work is in progress, open the next missing item
- if the advisor is reviewing, show "we're reviewing what you sent"
- if paperwork is ready, show the next signing or transfer step
- if onboarding is complete, show the final handoff page

The page should never say "pending" without explaining who has the next move.

Client-visible example while the firm is reviewing:

```text
We're reviewing what you shared.

You don't need to do anything right now. Jordan is checking the documents and
will reach out if anything is missing.
```

### 5. The checklist is complete

Completion is not the end of the journey. It is the handoff from collection to
relationship.

Client-visible completion copy example:

```text
Thanks, Mira. You've sent the information we need to start.

Our team is reviewing it now. You'll hear from Jordan when paperwork is ready
to sign.

You can return to this page any time to see where things stand.
```

The completion page keeps:

- the timeline
- who owns the next step
- contact help
- any pending signature or transfer state
- a calm "nothing needed from you" state when appropriate

## Default Timeline

The firm can rename or hide milestones, but the default journey should be
opinionated. It should work for a solo or small RIA without configuration.

| Milestone | Client meaning | Advisor board meaning |
|---|---|---|
| Welcome | The relationship has started and the secure page is ready | Link sent, welcome message sent or awaiting approval |
| Information needed | The client has items to answer or upload | Checklist open, missing items visible |
| Reviewing | The firm is checking what the client sent | Advisor or staff owns the next move |
| Paperwork | Forms, transfers, or signatures are being prepared | Intake data can feed Schwab, ACATS, DocuSign, and planning tools later |
| Signature or transfer | The client may need to sign or confirm something | Signature packet or transfer state attached to onboarding |
| Active client | Onboarding is complete and the Client Map is seeded | Client leaves the onboarding board and lives in the normal client view |

The timeline should be visual, but not busy. A vertical stepper works best on
mobile. A horizontal strip can work on desktop if it fits without squeezing the
checklist.

Important behavior:

- Milestones are not the same as checklist items.
- A milestone can contain many intake items.
- The client sees only plain milestone labels.
- The advisor can see the operational detail behind each milestone.
- The current milestone always has an owner: client, advisor, staff, custodian,
  or waiting on outside signature.

## Who Is Who At The Firm

The "your team" block turns firm roles into plain client help.

Default role types:

- **Lead advisor:** financial planning and advice
- **Client service associate:** documents, scheduling, and questions
- **Operations specialist:** account paperwork and transfers
- **Planning analyst:** plan preparation and data review
- **Firm owner or principal:** optional relationship anchor for smaller firms

Each person card needs:

- name
- title
- photo or initials
- "Ask me about" line
- contact method, if the firm wants it shown
- availability or response expectation, if the firm wants it shown

Client-visible example:

```text
Jordan Lee
Client service associate

Ask Jordan about uploads, signatures, and scheduling.
```

The firm should be able to set one default team for a template, then override it
for a specific client. For a solo advisor, the block can collapse to one person.

## AI-Drafted Welcome And Milestone Emails

This should feel like the planned nudge pattern, not a separate campaign tool.
Lantern drafts the message, shows why it drafted it, and waits for approval.

### Draft triggers

Lantern may suggest an email when:

- the advisor sends the intake link
- the client opens the link but does not start
- the client completes the first item
- the client uploads a document that unlocks the next step
- the client stalls with missing items
- the checklist becomes ready for advisor review
- paperwork is ready for signature
- a transfer or custodian step changes state
- onboarding completes

### The advisor approval card

The approval card should appear on the onboarding board and on the client's
onboarding tab. It contains:

- recipient
- subject
- draft body
- reason for the draft
- milestone or missing item that caused it
- source chips for any facts used
- edit area
- approve action
- dismiss action

Approval should be one clear action after review. If the email connector is
available, approval saves the message to the advisor's real mailbox drafts or
sends through the approved email path. If the connector is not available,
Lantern provides a copy-ready draft.

No client email should include sensitive values such as SSN, driver's license
number, account numbers, or exact balances. It may say "license" or "statement"
when needed.

### Advisor voice

The advisor voice should come from firm-approved examples, not a tone dropdown.

Inputs:

- firm welcome templates
- advisor-approved prior emails
- firm phrases to use or avoid
- client name and household name
- current milestone
- missing items
- allowed next-step language

Guardrails:

- never invent promises
- never invent dates
- never reveal sensitive values
- never sound like Lantern is the sender
- never imply the advisor has reviewed something they have not reviewed
- never send without approval

The advisor can correct the draft. Lantern should remember lightweight edits
for future drafts, the same way a good assistant learns "how Lena says this."

### Milestone email examples

Link opened but not started:

```text
Subject: Need help getting started?

Hi Mira,

I saw that your onboarding page is ready when you are.

The first step is just your driver's license upload. If you'd rather walk
through it together, reply here and Jordan can help.

Thanks,
Lena
```

Checklist ready for review:

```text
Subject: We have what we need for review

Hi Mira,

Thank you for sending your information. Our team is reviewing it now.

If we spot anything missing, Jordan will reach out with a short list. If
everything looks ready, we'll prepare the next paperwork step.

Thanks,
Lena
```

Paperwork ready:

```text
Subject: Your paperwork is ready to sign

Hi Mira,

Your paperwork is ready for review and signature.

Please use the link below when you are ready:
[Review and sign]

Reply here if anything looks confusing. Jordan can walk through it with you.

Thanks,
Lena
```

Onboarding complete:

```text
Subject: You're all set for the next step

Hi Mira,

You're all set for this part of onboarding.

We'll use what you shared to prepare for your first planning conversation. Your
secure page will stay available, so you can return to it if you need to check
where things stand.

Thanks,
Lena
```

## Firm-Level Templates

The firm needs defaults, but the product should not become a template maze.
Start with one firm-level **Welcome journey template** attached to each intake
template.

Template parts:

- welcome page headline and intro
- default timeline milestones
- team roles and default people
- help contact
- welcome email
- milestone email starters
- nudge spacing rules
- completion copy
- forbidden phrases
- compliance footer, if required by the firm

Template hierarchy:

1. **Lantern default:** works out of the box for a small advisory firm
2. **Firm default:** the firm's approved language and people
3. **Intake template default:** specific to a new household, rollover, or annual
   review intake
4. **Client override:** small per-client changes before sending

Template editing should happen where the advisor already composes intake. The
default flow:

1. Choose intake template
2. Review required checklist items
3. Review welcome journey
4. Send link

The welcome journey section should be collapsed by default after the firm has a
template. Most advisors should only change it when a client has a special case.

## How It Surfaces On The Onboarding Board

The onboarding board should answer one question: who needs what next?

Welcome journey data appears as board signal, not as a separate view.

Recommended board columns or row fields:

- **Client**
- **Current milestone**
- **Checklist progress**
- **Who has the next move**
- **Last client activity**
- **Missing items**
- **Next message**
- **Owner at the firm**

Example row:

| Client | Milestone | Next move | Next message |
|---|---|---|---|
| Mira Patel | Information needed | Client: spending estimate | Draft ready: gentle reminder |

The **Next message** cell is the main AI surface:

- "Welcome draft ready"
- "Reminder draft ready"
- "Paperwork-ready draft ready"
- "No message needed"
- "Client replied by email, confirm match"

Clicking the draft opens the approval card in place. The advisor should not have
to hunt for email drafts elsewhere.

Board filters:

- Needs advisor review
- Client has the next move
- Drafts awaiting approval
- Stalled
- Signature or transfer in progress
- Recently completed

"Recently completed" is useful for follow-through, but completed clients should
leave the active onboarding board after the firm's chosen archive rule.

## Per-Client Onboarding Tab

For existing clients still mid-process, the same journey appears on their client
page. This is how Intake's second entry point works.

The per-client view includes:

- current milestone
- checklist state
- what the client sees on the link
- team block
- email draft history
- approved and sent messages
- timeline of important onboarding events
- files and facts already added to the Client Map

This should not duplicate the whole onboarding board. It is the detail view for
one client.

## Email-Native And Phone-Walkthrough Support

The welcome journey must work even when the client never behaves like a portal
user.

### Email-native fallback

If the client replies to the welcome email with an answer or attachment, Lantern
should attach it to the same intake session and suggest a match:

```text
Client replied with one attachment.
Suggested match: driver's license back.
```

The advisor confirms before Lantern checks it off. The client timeline updates
after confirmation.

### Phone-walkthrough mode

If the advisor fills intake during a call, the client-facing link should still
reflect the journey:

- "Jordan helped complete this by phone"
- current milestone still advances
- welcome and milestone emails can still be drafted
- the audit trail records that staff entered the answer

This matters because many clients can handle email but dislike portals.

## Data And State Sketch

This is a design sketch, not a code plan. The important product rule is that the
welcome journey lives inside the intake record.

Suggested concepts:

- **Welcome journey template:** firm-approved timeline, roles, and copy starters
- **Welcome journey instance:** the per-client version attached to one intake link
- **Milestone state:** current stage, owner, timestamps, and completion notes
- **Team assignment:** people shown to the client and owners shown to the advisor
- **Draft message:** proposed email with trigger, sources, edits, approval status,
  and send outcome
- **Client-visible snapshot:** the current welcome page state rendered from the
  encrypted intake record

The Client Map should start growing from intake facts. The welcome journey should
make that visible to the advisor, not the client:

- "DOB received from intake"
- "License uploaded"
- "Income estimate received"
- "Spending answer marked rough"
- "Statement uploaded"

Each fact keeps its source and approval state.

## Edge Cases

- **Households with two people:** show both names, but avoid exposing one person's
  sensitive status to the other unless the intake session is explicitly shared.
- **One spouse completes everything:** the board should show the household status
  and the missing person's items separately.
- **Client opens an old link:** show a safe state: expired, revoked, or complete.
  Never show stale instructions as if they are current.
- **Staff changes mid-onboarding:** update the who-is-who block and draft a plain
  handoff note for approval.
- **Advisor is out of office:** firm template can swap the visible helper and route
  replies to the right person.
- **Client uploads the wrong document:** Document Detective owns the detection, but
  the welcome journey owns the calm next message.
- **Firm has compliance footer language:** template supports it, but the main copy
  remains short and human.

## Product Boundaries

Do:

- make the client feel expected and guided
- show the next step plainly
- make the firm feel organized
- let AI draft warm messages
- require advisor approval
- keep the welcome layer inside Intake

Do not:

- build a separate portal
- create a newsletter or campaign system
- add a global marketing automation tool
- let AI send client messages silently
- put sensitive data in email copy
- make firms configure everything before first use
- promise exact completion dates unless the firm manually writes them

## Demo Moment

The demo practice has one household currently onboarding.

The advisor opens the onboarding board and sees:

- Mira Patel is in **Information needed**
- driver's license and income are complete
- spending estimate is missing
- next message draft is ready

The advisor opens the draft, sees a warm reminder in their own voice, approves
it, and the row updates.

Then the same client link shows:

- "You're partway there"
- the next missing item
- who Jordan is
- what happens after the checklist is complete

Demo line:

```text
The same link that collects the data also keeps the client calm.
```

## Wave Sizing

This should ship as part of Lantern Intake, not ahead of it.

| Wave | Size | Fits with Intake | Delivers |
|---|---|---|---|
| WJ-1: Same-link welcome page | M | Intake Wave 1 | Welcome header, default timeline, who-is-who block, resume behavior, completion page |
| WJ-2: Board visibility | M | Intake board and nudges wave | Milestone column, next-move owner, welcome status, next-message draft slot |
| WJ-3: Advisor-approved email drafts | M/L | Nudge drafting wave | Welcome email, milestone emails, advisor voice inputs, approval card, sent/draft receipts |
| WJ-4: Firm templates | M | After first usable welcome defaults | Firm template editor, per-intake defaults, per-client overrides, forbidden phrases |
| WJ-5: Fallback polish | S/M | Email-native and phone mode waves | Email-reply milestone updates, phone-walkthrough labels, staff handoff drafts |

Smallest honest slice: **WJ-1 plus the board's current milestone field.** That
gives the client expectation-setting immediately without delaying the core E2EE
intake round trip.
