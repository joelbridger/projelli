# Reddit — r/consulting Post

> **Subreddit:** r/consulting (330K+ members). Mix of MBB, boutique, independent, and aspiring
> consultants. The independent/solo consultant segment (~15-20% of active posters) is Keepance's
> direct target.
>
> **Rules:** r/consulting allows genuine tool discussion and personal experience posts. Spam is
> flagged quickly. Lead with the problem, not the product. Self-promotion must be disclosed.
>
> **When to post:** After Consulting Practice pack ships publicly (post-PIVOT-12 and PIVOT-11).
> Have at least one or two consulting customers willing to comment positively before posting.
>
> **Tone:** r/consulting skews professional and direct. Less "excited" than r/SideProject. Honest
> about what the product doesn't do. Avoid jargon.

---

## Option A: Problem-first post (softest self-promotion)

**Title:** Has anyone else started thinking about AI NDA clauses in client contracts?

I've had two contracts in the last year that explicitly prohibited feeding client materials to AI
tools without written consent. One was a financial services client, one was healthcare. Neither one
told me upfront — I noticed it during contract review.

Curious whether this is becoming more common. Are you seeing AI-specific language in your client
NDAs? And if so, how are you handling it in practice?

(For context: I ended up building a local-first AI tool that processes client files on my machine
rather than sending them to a cloud service — so I have skin in the game here, but the question is
genuine.)

---

## Option B: Tool share post (direct, honest)

**Title:** Built a local-first AI workspace for consultants who work under NDA — would appreciate
feedback from practitioners

---

Background: I'm a designer by day, and I built a desktop AI tool because I wanted to use AI on
client work without having the data conversation.

The short version of what it does: AI chat where every conversation saves as a Markdown file on
your hard drive. You bring your own Anthropic/OpenAI/Google API key. The API call goes from your
machine directly to the provider. Keepance never sees the data.

I built a Consulting Practice template pack — five templates I thought independent consultants
actually run:

- Client Discovery Synthesizer (structures discovery call notes into a client brief)
- Confidential Research Memo (formats research with NDA-handling headers)
- Stakeholder Map Generator (maps stakeholders by role, stance, and influence)
- NDA-Safe Slide Outliner (builds a presentation outline that explicitly skips restricted content)
- Engagement Retrospective Builder (post-engagement structured review)

**What I want to know from people who actually do client work:**

1. Do these five templates cover the right moments in an engagement, or am I missing something obvious?
2. Is "NDA-Safe" a useful framing, or does it sound like I'm overpromising?
3. Is $129 one-time reasonable for a solo practitioner tool? (Includes the template pack.)

Disclosure: this is my product (keepance.com). Not trying to spam — I genuinely want practitioner
input before I push this more broadly.

---

## Engagement plan

- Post Option B when ready
- First comment: ask specifically about template coverage gaps
- Reply to every comment for the first 24 hours
- If commenters want to try it: send a DM with a trial link or a free license key for their feedback
- Do NOT reply defensively to criticism — every piece of critical feedback is a public demonstration
  of good faith
- If the post gets traction: share to r/IndependentConsultants (smaller, more targeted)

## Notes

- r/consulting mods are active. Make the disclosure obvious — bury it and it'll be removed.
- The MBB crowd may dismiss this as too simple for their work. That's fine. The target is
  independent consultants, not Deloitte staff.
- If someone asks about security beyond "local files": explain that Keepance has no server-side
  component for user data, the API key lives in the OS keychain (not Keepance's database), and
  there is nothing to subpoena because nothing is stored outside the user's machine.
