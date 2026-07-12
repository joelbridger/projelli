# Where Lantern deliberately differs from Wealthbox

*For Jameson. Written 2026-07-12, before he uses the app — not after he finds it.*

His bar is that this app does **everything** Wealthbox can. We measure ourselves against a
list of 80 Wealthbox features and we report the score honestly. This page is the short list
of places where we **chose** to be different. Not "not done yet" — **chosen**, with a reason.

Everything not on this page, we are building and measuring. If it is not on this page and it
does not work, that is a bug and we want to hear about it.

---

## 1. We do not have "Agents" that act on their own

**Wealthbox has:** an early-access feature where the AI goes off and takes actions by itself.

**We deliberately do not.** In Lantern, the AI **proposes** and **you decide**. Every action
the AI wants to take shows up for your approval first.

**Why:** this is not a missing feature, it is the product. Your clients' money and personal
lives are in here. The moment software can act on that without a human looking, the whole
promise of the thing is gone — and an advisor who cannot say exactly what happened to a
client's record cannot answer a regulator either. We would rather be the tool you can vouch
for than the tool that surprises you.

**What you get instead:** the AI does the work and hands it to you to approve — same speed,
you stay in the chair.

*If you want us to change this, say so and we will. But we will not ship it quietly.*

---

## 2. Things we deliberately left out, because they are not for a firm your size

| Wealthbox has | Why we skipped it |
|---|---|
| A built-in phone dialer + caller ID | Phone infrastructure. A small firm already has a phone. |
| Mobile apps (iOS/Android) | Not in this build. The app is a desktop app today. |
| Marketing email blasts | We do a small, approval-visible one-to-many send to a client list. We are not building a marketing tool. |

---

## 3. Things Wealthbox does that we do *differently*, on purpose

**The email dropbox.** Wealthbox gives you an address to BCC, and their server keeps a plain
readable copy of that email forever. **We capture it on your machine instead**, so a copy of
your client's email never sits in plain text on somebody else's server. You get the same
habit — drop an email in, it lands on the right client — without the exposure.

---

## How to read our score

We measure **80** Wealthbox features. A feature only counts as **BUILT** when a test drove
the real app on real Windows, did the thing a person would do, **restarted the app**, and
found the result still there. A passing internal test does not count. If we cannot prove it,
we call it not built — even when we are fairly sure it works.

*Anything we deliberately do not replicate is on this page. Nothing hidden.*
