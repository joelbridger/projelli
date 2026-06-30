# Advisor Prep Hero: Full Evaluation and Where to Go Next

*A CEO-level read of the whole project, June 25, 2026. Written for Jameson. Plain language on purpose.*

---

## The one-paragraph answer

Advisor Prep Hero is a genuinely impressive, deep piece of software, and that is not the problem. The problem is that almost nobody is using it yet: zero paying customers and only a trickle of website visitors. The building is way ahead of the selling. So the demo you are working on right now is the single most important thing happening on this project, because it is your bridge to your very first real users (your wife, then her firm). The financial-advisor software world is a crowded, hard neighborhood to move into, and there is one competitor already saying almost exactly what we want to say. So my recommendation as your CEO is simple and a little uncomfortable: **stop adding big new features for a while, and instead use the demo to turn a handful of real advisors into weekly users, with at least one or two paying.** If 3 to 5 advisors are using it every week within about two months, you have a real business. If not, you will have learned that quickly and cheaply, instead of building for another year on a hunch.

---

## 1. Where we actually are today

Think of "how far along are we" in three separate buckets. They are at very different places.

| Bucket | How far along | Plain meaning |
|---|---|---|
| **The engineering** | High | A lot is genuinely built and works. |
| **The polish** | Medium | It works, but recent real-world testing still found basic things that broke. |
| **The business (actual customers)** | Almost zero | 0 paying customers. ~225 website visitors in 10 weeks. ~5 clicks on "Buy". 0 sales. |

**The analogy:** we have built a beautiful, powerful car. We just have not sold a single one, and only a few people have ever sat in it.

This matters because it is easy to *feel* like progress (new features, fixed bugs, a nicer website) while the one number that decides whether this is a business (real users) stays at zero. Both my own research and the independent second opinion from Codex landed on the exact same verdict, in almost the same words: **Advisor Prep Hero is an impressive pre-traction product, not yet a proven startup.**

### What is actually built
In plain terms, Advisor Prep Hero is a private app that lives on the advisor's own computer. You point it at a client's files and emails, and it does three useful things:
- It builds a **"Client Map"**: an automatically-assembled, always-updating profile of everything known about a client or household (their people, goals, accounts, risks, open to-do items), where every fact links back to the exact document it came from.
- It lets you **ask questions across all of it** and get answers with clickable sources you can verify.
- The key promise: **the client's private data never goes to a Advisor Prep Hero server.** The AI runs either fully on the advisor's machine, or talks straight to an AI provider using the advisor's own key.

The real catch on "what's built": the newest and best work (the Client Map, the advisor re-aim) is finished in the code but **has not been packaged into an installer customers can download yet.** The last version actually published is older. That is a deliberate choice (a real release needs your go-ahead), but it means the polished advisor product technically does not exist in customers' hands today.

---

## 2. The demo you are building (my read)

This is your current focus, and it is the right focus.

**What it is:** a roughly 8 to 10 minute guided walkthrough of the real app, told in four steps:
1. **Sign in as an advisor** and pick a folder and an AI option. *(Proves: private and advisor-native from the first screen.)*
2. **Import a sample client's messy pile of files** (a household called "Hendricks"). *(Proves: real scattered files go in, nothing leaves the machine.)*
3. **Watch the Client Map build itself** from those files, with sources cited and gaps flagged. *(This is the heart of the product, the "wow" moment.)*
4. **Ask the files a real pre-meeting question** and click the citation to open the exact source. *(Proves: a private assistant that actually knows your clients.)*

**How ready is it?** Close. The "wow" path genuinely works on a clean Windows machine right now, and a dedicated build instance has been hunting and fixing bugs (including a recent one where answers were not showing their sources, now fixed). It is ready to **show, with you driving**, very soon. It is not yet ready to hand an advisor and walk away.

**Three things that would most protect you before you show your wife:**
1. **One full clean rehearsal** end to end on a fresh build, to make sure nothing flakes out live (the parts that broke recently are exactly the parts the demo leans on).
2. **Sanitize the demo machine** (there is a real developer email account connected to the test setup right now; disconnect it so nothing off-topic shows up on screen).
3. **Pick ONE star client and make it flawless.** Depth on one believable household sells far better than breadth across many.

**Verdict:** Yes, show your wife soon, as a guided tour you drive, not as software you leave with her. Do one clean dress rehearsal before her firm sees it.

---

## 3. The challenge you flagged: fitting into the advisor software world

You are right to worry about this. It is the real risk. Here is the honest picture from the research.

**Advisors already live inside a "stack" of tools they almost never change.** Every advisor has a CRM (their contact/relationship system), a financial-planning tool, a connection to their custodian (the firm that actually holds the money, like Schwab or Fidelity), and increasingly an AI note-taker. The blunt stat: advisors switch any given tool only about **3 to 5% per year.** They are sticky and busy, and a new tool that does not connect to what they already use feels like "yet another login" and gets dropped.

That is the headwind. **But there is a genuine gap, too:** no one cleanly owns "a private, smart organizer of everything a firm knows about a client, sitting on top of the documents they already have." Most advisors today just dump files into generic storage (Microsoft, Dropbox, Box) that is not smart at all. And new privacy regulation is quietly pushing on our side: a rule called **Reg S-P** (with compliance deadlines that just passed in Dec 2025 and arrive again in June 2026) forces advisors to protect client data much more carefully. That plays directly to our "your data stays on your machine" angle.

So the situation is: **a real gap exists, but the window is open, not forever.**

---

## 4. Who we are up against (the current snapshot)

This is the part the online research sharpened most. The space is filling up fast.

- **FutureVault — the one to watch closely.** This is the most direct competitor. They already pitch almost our exact idea (a "client life vault" with intelligent document processing) and in **early 2026 they launched an "AI Advisor Insights Engine"** that turns client documents into real-time intelligence. They are enterprise-backed and already in the market. We need to know precisely how we are different from them.
- **Jump and Zocks — the funded giants of the adjacent space.** These are AI note-takers (they listen to client meetings and write the notes). Jump has raised about **$105M** and is used by roughly **1 in 10 U.S. advisors**; Zocks raised **$45M**. They are now expanding from notes into becoming a whole "advisor operating system." **We should not fight them head-on.** They are too well-funded, and that specific race is basically over. But they prove advisors will happily adopt AI, which is good for us.
- **The incumbents adding AI (Wealthbox, Orion, eMoney).** These are tools advisors already pay for, now bolting AI on. Their advantage is not better AI; it is "already in your stack, and the compliance paperwork is already done."
- **Microsoft 365 Copilot + Purview.** For any firm already living in Microsoft, this is the safe, boring default AI choice with all the compliance boxes ticked.

**The pattern:** several well-funded players are converging on "AI that knows your clients." We have a real angle, but we are the small, unfunded entrant. Speed and focus are our only advantages.

---

## 5. Our real edge, and its honest limit

**Our edge:** private and local-first, plus the "Client Map" structure, plus answers that cite their sources, all over the firm's *own* documents and email. In one line: **we turn the advisor's single biggest fear (sending private client data to AI) into our single biggest selling point.** None of the big, well-funded players lead with "your data never leaves your machine," and the new privacy rules make that genuinely valuable.

**The honest limit (both my research and Codex flagged this):**
- It is a **narrow buyer.** Many firms will actually feel *safer* with a big-name vendor that has formal security certifications and signed legal paperwork than with a small solo app, even if the small app is technically more private.
- Our "private" claim has an asterisk: when an advisor uses the cloud-AI option, the data still goes to that AI provider (OpenAI, Anthropic, etc.). We must be completely honest about this. The fully-private story is real only in local mode.
- We have **none of the trust paperwork yet** (no formal security audit, no signed data agreements, the business is not even a formal company entity yet). That is exactly what a firm's compliance officer asks for first.

---

## 6. The pivot question: am I thrashing?

You did not ask this directly, but it is the elephant in the room and you deserve a straight answer.

This advisor focus is roughly the **fourth or fifth re-aim** of the same underlying engine in a short period (indie founders, then lawyers/professionals, then law firms specifically, then "private client intelligence," now financial advisors). Codex called this out bluntly, and it is fair: the pattern has been "write a compelling new story, find no traction, rewrite the story."

**Here is the balanced truth:** the advisor pivot is the **soundest one yet.** There is a real pain signal (it came from an actual advisor), there is a warm design partner (your wife and her firm), and "organize everything about a client household" fits advisors more naturally than it fit lawyers. So the *direction* is good.

**But** a good story is not proof. The cure for thrashing is to stop treating each new positioning as "the answer" and instead let **customers** prove it this time. Concretely, the advisor pivot is validated only when real advisors use it every week. Codex proposed a clean test that I fully agree with: **within about 45 to 60 days, get 3 to 5 advisors using it weekly, with at least some paying.** If that happens, the thrashing era is over and you have found it. If it does not, you will know the advisor thesis is not it, without another year lost.

---

## 7. What I would do next (my recommendation as your CEO)

Three moves, in order. Notice that "build more features" is deliberately not on the list.

**Move 1: Finish the demo, then run a "first 5 advisors" proof sprint.**
Your wife is design partner number one. Then her firm. Then a few more advisors found through the places advisors actually hang out (advisor communities like XYPN, and the Kitces world, which is the trusted hub for advisor software). The goal is not applause. The goal is **weekly real use and one or two paid pilots.** The test that matters: would they be genuinely upset if Advisor Prep Hero disappeared tomorrow?

**Move 2: Make ONE path bulletproof, and pause everything else.**
The path: pick a client folder, build the Client Map, ask a cited question, draft a review note. Make that loop rock-solid and easy enough for a normal, non-technical advisor on a normal Windows machine. No new big features until that one loop is boring and reliable.

**Move 3: Build the "trust packet."**
This is the unglamorous work that actually unlocks firms. Form a real business entity. Write a single-page "here is exactly where your data goes" sheet that a compliance officer can read and forward. Scrub any wording that sounds like a compliance guarantee (regulators are actively punishing AI products that over-claim, so this also protects you).

**Plus one hour of homework:** study FutureVault closely and write down, in one sentence, why an advisor should choose us over them. If we cannot answer that crisply, that is the most important thing to fix.

---

## 8. The bottom line

You have built something real and, for a solo founder, remarkable. The risk now is not that the product is too weak; it is that you keep improving the product while the customer count stays at zero. The demo is the right lever at the right moment. Point it at real advisors, treat the next two months as a make-or-break market test rather than another build cycle, and let actual usage, not another strategy document, tell you whether this is the one.

The single most encouraging fact: two independent analyses (mine and Codex's), run separately, reached the identical conclusion. That rarely happens, and it means the path is clear. The only question left is whether you want to commit to it.
