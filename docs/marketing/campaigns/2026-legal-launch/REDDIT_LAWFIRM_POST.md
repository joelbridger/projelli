# r/LawFirm Community Post

> **Subreddit:** r/LawFirm (350K+ members). Also consider r/Lawyertalk, r/legaladvice (for visibility),
> r/AIPLA (for patent practitioners specifically).
>
> **When to post:** After the Legal Practice pack ships (v2.1). Don't post a tool showcase
> before the templates are ready. Post on a Tuesday or Wednesday morning.
>
> **Format:** Tool showcase / "I built this" style. Lead with the problem, not the product.
> Be completely transparent about being the developer. Redditors respect honesty and hate anything
> that smells like a stealth ad.
>
> **Heppner citation: VERIFIED.** *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026) (Rakoff, J.). Can be included in the post with appropriate framing — frame it as evidence of privilege risk from unprotected AI use, not as a guarantee of what prevents waiver.

---

## Post draft

**Title:** I built a local-first AI workspace specifically because of the privilege problem with cloud tools. Solo and small-firm attorneys seem like the right audience to tell me if I got it wrong.

---

**Body:**

I'm a product designer, not an attorney. I want to say that upfront because it's relevant to what I'm asking.

I've been building a desktop app called Advisor Prep Hero for about a year. The premise is that professionals who work under confidentiality obligations (attorneys, CPAs, consultants) shouldn't have to choose between using AI and keeping their clients' information private. The product runs entirely on your machine. No server I control ever sees your files. Your API key goes direct from your computer to Anthropic/OpenAI/Google. Nothing passes through me.

I just shipped a Legal Practice template pack: a Deposition Contradiction Finder, Evidence Gap Analyzer, Case Timeline Builder, Privilege Log Drafter, Discovery Document Triage tool, Client Intake Synthesizer, and a Patent Disclosure Draft template for IP attorneys. These were reviewed by [attorney advisor name] before shipping, but I'm sure there are things I got wrong or framed in a way that doesn't match how practitioners actually work.

A few specific things I'd genuinely like feedback on:

1. The Privilege Log Drafter assumes a particular structure for the log. Does that match what you're actually generating in discovery? Different courts seem to have different requirements.

2. The Deposition Contradiction Finder asks you to paste deposition excerpts and have the AI flag internal inconsistencies. Is there a workflow reason you'd want this to run on a full transcript vs. excerpts you've already flagged as interesting?

3. The Patent Disclosure Draft is the one I'm least confident about. It's built around the EU absolute-novelty concern. If you do prosecution work, I'd love to know if the framing is realistic.

The app is at keepance.com. There's a Solo plan ($39/mo or $468/yr) and a Professional plan ($79/mo or $948/yr) that includes the Legal Practice pack. I'm not here to push sales. I'm here because this subreddit is full of practitioners who will tell me exactly what's wrong with my thinking, which is exactly what I need.

---

## Notes

- Pin the attorney advisor's name in the post body as soon as you have one. "Reviewed by [Name], [bar state] (solo practice)" adds a lot of credibility.
- Respond to every comment in the thread for at least 48 hours after posting.
- Do not get defensive about negative feedback. The best response to "this doesn't match how I actually work" is "tell me more."
- If someone asks "why not just use [other tool]?" the answer is: "If that tool meets your confidentiality requirements, use it. I built this for practitioners who specifically need the data to stay on their machine."
