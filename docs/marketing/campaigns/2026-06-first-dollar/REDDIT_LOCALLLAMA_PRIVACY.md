# Reddit: r/LocalLLaMA + r/privacy: first dollar

**Owner: Jameson posts.** These subs are allergic to stealth marketing, so the honest founder disclosure is not optional, it's what keeps the post alive. Check each sub's self-promo rules before posting; some want a flair or a set day. Reuse comment replies from `REPLY_BANK.md` and `COMPETITIVE_LANDSCAPE.md`.

**Hard rule:** no compliance claims. Local-first, BYOK, and Ollama support are the whole pitch here, and they happen to be exactly what these subs care about.

---

## r/LocalLLaMA

**Title:**
> I built a local-first AI workspace that saves every chat as a file on your disk and runs against Ollama (BYOK for the cloud models)

**Body:**

> Sharing a thing I've been building, because this sub is pretty much the exact crowd I made it for.
>
> It's a desktop app called Keepance. You chat with an AI inside it, and every conversation gets written to disk as a file in a folder you choose. The cloud providers (Claude, GPT, Gemini) use your own API key, and the key sits in your OS keychain, so requests go straight from your machine to the provider with nothing of mine in the middle. If you'd rather stay fully local, it talks to Ollama, so you can run the whole thing against a model on your own box and nothing leaves the machine at all.
>
> There's no account and no telemetry phoning home. There's no server of mine that your data ever passes through. The files are in a normal folder, so if Keepance vanished tomorrow you'd still have everything in a format anything can read.
>
> Beyond the chat, the files behave like a notes app: [[wiki-links]] between notes, backlinks, full-text search, version history, split panes. So the AI conversations and your own writing become one searchable pile instead of scrollback you lose.
>
> It's Tauri (Rust) rather than Electron, so the install is small. Signed on Windows, notarized on Mac, Linux build too.
>
> Honest disclosure, since this sub rightly hates stealth marketing: I'm the founder, it's a paid app ($39/mo or $468/yr for the Solo plan, 30-day trial, no card). I'm posting here because the local-model and own-your-data angle is the actual point of the product, not a checkbox I bolted on. https://keepance.com
>
> Tear it apart. I want the feedback.

---

## r/privacy

Same product, different emphasis. r/privacy cares less about model performance and more about "where does my data actually go." Lead with that, drop the Ollama-as-speed angle, keep Ollama as the "fully local, nothing leaves" option.

**Title:**
> A local-first AI app where the chats are plain files on your disk, your API key stays in your keychain, and nothing routes through my servers

**Body:**

> I got tired of every AI tool wanting my data on someone else's box, so I built one that doesn't.
>
> Keepance is a desktop app. You chat with an AI, and each conversation is saved as a file in a folder you pick. No account to make. No telemetry. No server of mine that your conversations pass through. For the cloud models (Claude, GPT, Gemini) you bring your own API key, it's stored in your OS keychain, and the request goes straight from your machine to that provider. If you don't want anything leaving your machine at all, it runs against a local Ollama model and stays fully offline.
>
> The thing I'd point at for this sub: the output is just files. Markdown in a normal folder you control, readable and portable without my app, deletable by dragging them to the trash. There's no lock-in and no copy of your data that I'm sitting on, because I never receive it.
>
> One honest caveat I'll say out loud: if you use a cloud model, that provider still sees the prompt you send them, the same as any API call. The local-first part is that *I* never do, and nothing is stored anywhere but your own disk. If you want zero third parties in the loop, use the Ollama path.
>
> Disclosure: I'm the founder, it's a paid app, $39/mo or $468/yr for Solo, 30-day trial, no card. Posting because the privacy model is the actual product. https://keepance.com
>
> Happy to answer anything, including the uncomfortable questions.

---

## Notes

- The r/privacy "honest caveat" paragraph is doing real work. That sub will respect you for naming the provider-sees-the-prompt limit before they catch you on it. Keep it.
- Don't cross-post the identical text to both subs on the same day, the mods notice. Space them out, and tailor the title to the sub.
- If r/LocalLLaMA bites, r/selfhosted and r/opensource are natural follow-ups, but only if the source-availability question is answered honestly (it isn't fully open yet, so lead with the trust model, not a license claim).
