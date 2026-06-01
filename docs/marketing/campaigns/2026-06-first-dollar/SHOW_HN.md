# Show HN: first dollar

**Owner: Jameson posts.** Best window is a US weekday morning. Be around for the first few hours to answer; HN rewards the founder showing up in the thread. Pull comment replies from `docs/marketing/playbook/REPLY_BANK.md` (Block 3 is HN-flavor) and `docs/reference/COMPETITIVE_LANDSCAPE.md`.

**Hard rule:** no compliance claims. This is the local-first / BYOK / chat-as-files story only. HN does not need the law/tax angle and would pick apart any bar-opinion framing.

---

## Title

Show HN titles are factual and plain. No hype words. Lead variant:

> Show HN: Keepance – Local-first AI workspace where every chat becomes a Markdown file

Alternates:
- Show HN: Keepance – BYOK AI workspace that writes every chat to a folder on your disk
- Show HN: Keepance – Chat with Claude/GPT/Ollama, every conversation saved as local Markdown

---

## Body

> I'm a product designer, not really a developer, so go easy on me. I've spent the last few months building this and I'd rather hear what HN thinks before I tell anyone it's finished.
>
> Keepance is a desktop AI workspace that keeps everything on your machine. You chat with Claude, GPT, Gemini, or a local Ollama model, and every conversation gets written out as a real Markdown file in a folder you pick. There's no Keepance account and no Keepance server in the loop. You bring your own API key, it lives in your OS keychain, and requests go straight from your machine to whichever provider you chose.
>
> The part I actually care about is that the chat isn't a dead end. Each conversation is a file you can edit, link to other files with [[wiki-links]], search full-text, and keep version history on. So the AI work and your own notes end up as one pile of Markdown, sitting in a normal folder, readable without Keepance if it ever disappeared.
>
> Stack, for the curious: Tauri 2 (Rust shell, not Electron), React and TypeScript on the front, CodeMirror 6 for the editor, SQLite for the index, FlexSearch for search. Installers are signed on Windows and notarized on Mac, and there's a Linux build.
>
> What it deliberately is not: no cloud sync, no collaboration, no mobile app yet, and no autonomous agent running off doing things while you're away. The AI proposes, you decide, and anything destructive asks first. That part is on purpose.
>
> I built it because a lot of my own work is the kind you can't paste into someone else's cloud, and I got tired of the chat history living on a server I don't control. Your own key plus local files was the honest fix.
>
> It's $49 once for the personal version, with a 30-day trial, no card, no account: https://keepance.com
>
> I'd genuinely love to be told what's wrong with it. Honest read, please.

---

## First-comment add-on (optional, post as your own first reply)

HN likes a founder who front-loads the "why should I trust a binary" stuff. If you want, drop this as the first comment:

> A few things people usually ask first:
>
> Source isn't fully open yet, but the trust model doesn't depend on trusting me: your key is in the OS keychain, the network calls go to the provider you picked, and the output is plain Markdown in your own folder. You can watch the traffic and read the files without me.
>
> It's a one-time $49 because there's no cost for me to serve, you're paying the inference, not me. The trial is the full app for 30 days, no card.
>
> If you want me to add or fix something, this thread is the best place. I'm here for the day.

---

## Anti-patterns (HN will punish these)

- No adjectives like "powerful," "seamless," "revolutionary." Plain nouns and verbs.
- Don't oversell. Understate, let the demo and the thread do the work.
- Don't argue with critics. Concede the real points, answer the rest with specifics.
- Don't claim privacy you can't back. "Requests go to the provider, files stay local" is true and checkable. "Totally private" is not, because the provider still sees the prompt unless you're on Ollama. Say exactly that if asked.
