# Keepance — The Product Journey

*A plain-language history of how Keepance came to be, and the big turns it took along the way. Written so anyone can follow it, no engineering background needed.*

---

> ## 📌 How to keep this log current (read this first)
>
> **The rule:** whenever a **major** decision or change of direction happens, add a short, dated, plain-language entry to this file. This is the one place that tells the *story* of Keepance at a high level, so it has to stay current.
>
> **What counts as "major"** (these get an entry):
> - A **strategic pivot or repositioning** (e.g. "we're now for advisors, not lawyers").
> - A **major feature milestone** that actually ships (a headline release, a flagship capability going live).
> - A **significant change to what the product fundamentally is** (its identity, its core architecture).
> - A **go / no-go or direction call** from Jameson or the CEO seat.
> - A **major release** (a new headline version).
> - **Abandoning or replacing a major approach** (we tried X, we're dropping it for Y).
>
> **What does NOT count:** ordinary code changes, bug fixes, small features, routine work. Those already live in `CHANGELOG.md`, which logs *all* notable changes. This file is the higher-altitude story, not a change list. When in doubt, ask: "Would a smart person who doesn't work here want to know this to understand where Keepance is headed?" If yes, add it.
>
> **The format** for each new entry:
> ```
> ### YYYY-MM-DD — <plain-language headline>
> ```
> Then 2 to 5 plain sentences: **what changed, and why it mattered.** No jargon. No file paths or code or commit codes as the main content (you can mention a specific thing in passing if it helps, framed plainly).
>
> **Order:** newest at the **bottom**. Add each new entry in time order at the end of the timeline below.
>
> **Who keeps it current:** the coordinator and the product workers. This rule also lives in the repo's `CLAUDE.md` and in the coordinator playbook, so nobody forgets.

---

## The story so far (January to June 2026)

### It started as a notes app for solo founders (late January 2026)

Keepance was not born as Keepance. The first version, built starting **28 January 2026**, was called **Projelli**. It was an AI workspace aimed at indie founders and solo builders: a place to keep your notes where every conversation you had with the AI turned into a real file you owned and could edit later. Two ideas were baked in from day one and never left: your files live on **your** machine (not on someone else's cloud), and you bring your **own** AI key, so the company never holds your data or your keys. Within a couple of weeks it grew from a browser tool into a proper desktop app you install on Windows or Mac.

### It learned to handle real documents and remember your stuff (April 2026)

Through the spring it got a lot more capable. By **mid-April 2026** it could open and edit real Office files (Word, Excel, PowerPoint), it auto-updated itself, and it picked up four headline powers in the **v1.5** release: it could **remember and search your own files** so the AI could answer from them, it could plug into **other AI tools** you already used, it let the **AI edit a document side-by-side** with you so you accepted only the changes you liked, and it could run **fully offline on a free local AI model** plus take voice input. A follow-up **v2.0** push in **early May 2026** rounded out the gaps (reading PDFs and images, a plugin system, the AI reading answers aloud, and support for Spanish and German). At this point it was a genuinely useful private AI workspace, but it was still pitched at founders and still had almost no users.

### The first big repositioning: from founders to confidential professionals (late May 2026)

In **late May 2026** came the first major turn. The team realized "indie founders" was a crowded, hard-to-reach audience, and that the product's real superpower (keeping sensitive work private on your own machine) mattered far more to people who handle **confidential client work**. So the whole thing was repositioned for professionals whose job is secrecy: **lawyers first**, then tax preparers and CPAs, then consultants. On **29 May 2026** the app was renamed from Projelli to **Keepance** (v2.1), got a new look (a navy shield instead of the old jelly-bean), new pricing tiers, and "profession packs" of ready-made templates for each kind of work.

### Sharpening trust and adding email (early June 2026)

Early June was about making the product honest and trustworthy enough for a professional to rely on. A run of releases added **verification banners** (when the AI produces a citation, it gets flagged "check this before you rely on it," because AI can make things up), a real **export pipeline** to Word, PDF, and PowerPoint, and an integrity pass that scrubbed any marketing claim the product couldn't actually back up. Then, on **8 June 2026**, **email came to Keepance**: you could pull your Outlook, Gmail, or other email into Keepance, where it was locked up safely on your own machine and made searchable, never routed through a company server.

### Keepance 3.0: it grew up into a real platform (9 June 2026)

**9 June 2026** was the biggest single moment so far. Keepance **3.0** turned a solo-user experiment into a real, professional product, and re-described it as **"the private intelligence layer for a law practice."** The headline pieces:
- Its **own Word engine**, built from scratch, with tracked changes and an **"AI redline"** that revises a document from a plain-English instruction, leaving every edit as a tracked change the lawyer accepts or rejects.
- **Answers grounded in your own files, with clickable citations**, kept strictly separate per client so one client's documents can never leak into another's.
- An **honest trust layer**: a live indicator that always tells you exactly where your data is about to go, a printable "Data Map" you can show a worried client, and a choice between keeping everything **fully on your machine**, sending it straight to your own AI provider, or routing it through a no-storage proxy.
- A **firm tier** where several lawyers can collaborate, with the shared data scrambled end-to-end so the relay in the middle can never read it.
- It shipped as **proper signed installers** for Windows, Mac, and Linux, with automatic updates and real paid subscriptions.

The next few weeks (3.1 and 3.2, through **mid-June**) polished and completed this: the firm tier became fully usable, a nasty memory bug that could crash the app was fixed, and big new capabilities landed (single sign-on for firms, an **encrypted vault** for your files, the ability to **read scanned PDFs**, and **live multi-person editing** of the same Word document).

### The honest reckoning: a good product almost nobody was using (17 June 2026)

By **17 June 2026** the team stopped and looked hard at the numbers, and they were sobering. Despite all this genuinely strong software, there were essentially **zero paying customers, almost no website visitors, and no sales.** The uncomfortable conclusion: the thing holding Keepance back was **not** the engineering. It was **trust and distribution.** A law firm won't buy serious software from someone they've never heard of with no references and no track record, no matter how good it is. The call was to stop piling on features, fix every claim that overpromised, and start selling to real people by hand. *(A note for honesty: a later round of hands-on testing showed the product still had rough, unfinished corners too, so "just go sell it" was a bit too tidy. Finishing the product and finding customers turned out to be work that had to happen together.)*

### The big pivot: from lawyers to financial advisors (23 June 2026)

The most important turn came on **23 June 2026**. While doing the sales rethink, the team noticed something they'd been walking past: the one person who had described **real, unprompted, "I would use this every single day" pain** was not a litigator at all. It was a **financial advisor** (Jameson's wife). She needed to know everything about a household before each meeting, and was stitching that picture together by hand across eight different tools every week.

That changed everything. Financial advisors turned out to be a much better fit than lawyers: they have real software budgets, a **cleaner privacy story** (the rules that govern them are about safeguarding client data, which Keepance already nails, rather than the thornier world of legal privilege), and, crucially, **a warm first customer already existed** instead of a cold list of strangers. So Keepance re-aimed at advisors. The organizing idea shifted from a legal **"matter"** (one case) to a **"client" or "household"** (the family an advisor looks after) — a shift from one-off legal jobs to ongoing relationships. Importantly, this was mostly a change of **words and framing**: under the hood the engine stayed exactly the same, only the labels and the story changed.

Around the pivot, Keepance also clarified that it is **not** trying to replace the tools advisors already use (their CRM, their planning software). It's the private layer **underneath** all of them that finally holds the *whole* picture of a client and answers questions about it with citations. A read-only connector to **Wealthbox** (a popular advisor CRM) was designed so Keepance could pull a client's real records in.

### Where Keepance stands today (28 June 2026)

The strategic call for the next stretch is simple and deliberately narrow: **prove that real advisors will actually use this every week, and that at least one or two will pay.** No new features for now. The plan is to get Jameson's wife's firm using it weekly first, then a handful of other advisors.

To support that, the last days of June brought a big **redesign of how you move around the app**: it was simplified to **three clear tabs (Client Map, Ask, and Workflows)**, the per-client view was fixed so you stay inside one client's world, and the "Ask" screen was reshaped to feel like a familiar chat app. The app was also scrubbed to lead with advisors (a sample advisor household is what you now see first), and a realistic set of fake advisor data was seeded so demos feel real.

The bottom line as of **28 June 2026**: the code is healthy and green, there's a **live web demo** anyone can click through, and the real app **passed a careful three-times-in-a-row test on real Windows hardware with zero bugs** — the strongest health signal in months. Nothing has shipped to outside users yet; it's still pre-launch. The whole game now is turning the first real advisors into weekly, paying users.
