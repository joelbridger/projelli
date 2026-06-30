# The quiet privilege problem with cloud AI tools

*Draft for Lawyerist. Author: Jameson Daines, keepance.com.*

*Disclosure: I'm the developer of Advisor Prep Hero, a local-first AI workspace for professionals with confidentiality obligations. I'll flag that clearly in the article itself. The analysis here applies to any tool in this category, not just mine.*

> **Heppner citation status: VERIFIED.** *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.). You may now add the citation to this article. Suggested placement: in the privilege section, after the ABA Opinion 512 discussion. Frame as: "A February 2026 SDNY ruling illustrates the risk — a defendant who used consumer Claude without attorney direction saw no privilege protection. The court's analysis supports the view that counsel-directed, confidentiality-preserving use is the right fact pattern." Do not claim this as a holding about what guarantees privilege.

---

Picture this. It's a Tuesday afternoon, and a solo practitioner is preparing for a preliminary hearing. They've got four hundred pages of discovery, a client file full of intake notes, and about two hours before dinner. They paste a few key paragraphs into ChatGPT: the incident summary, some witness statements, a few lines from the police report. They ask for a summary of the factual timeline. The response comes back in thirty seconds, clear and organized. They've just saved ninety minutes.

Did they also just share privileged information with a third party?

That's the question. And the honest answer is: it depends on things most practitioners haven't had time to fully think through. That's not a criticism. AI tools moved fast, and the ethics guidance moved slower. This piece is an attempt to lay out the actual analysis so you can make a real decision about which tools you're comfortable using.

I am not an attorney. That matters, and I'll come back to it.

---

## What ABA Opinion 512 actually says

ABA Formal Opinion 512, issued in July 2024, was the first formal guidance from the bar on AI use in legal practice. Most of the coverage at the time focused on the headline: the opinion didn't prohibit AI use. That's accurate. But the more practically useful section is what the opinion actually requires.

Opinion 512 grounds the analysis in existing duties you already have: competence under Rule 1.1, confidentiality under Rule 1.6, and supervision under Rules 5.1 and 5.3. The opinion doesn't create new obligations. It applies existing ones to a new context.

What "competence" means for AI tools is that you need to understand how a tool works well enough to supervise its output. What "confidentiality" means is that before you use a tool with client information, you need to do a genuine review of whether using that tool constitutes unauthorized disclosure. The opinion uses the phrase "reasonable efforts" and points to things like reviewing the tool's terms of service, understanding its data practices, and assessing whether any confidentiality protections are actually in place.

The opinion also notes that consent or contractual protections with an AI provider can satisfy the confidentiality analysis. In other words, enterprise agreements with data isolation commitments are a legitimate path.

The key phrase is "reasonable efforts." That's not a high bar, but it is a real one. It means you can't just assume your data is private because a product's marketing page says it is.

A February 2026 ruling from the Southern District of New York put a sharper point on the risk. In *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), the defendant had used consumer Claude without attorney direction or confidentiality safeguards. The court found no privilege protection for those communications. The ruling does not resolve the question of what architectural choices are sufficient to preserve privilege, but it draws a meaningful line between unguided consumer AI use and counsel-directed workflows where the attorney remains in control of what goes in and what comes out.

---

## Where the data goes, actually

When you send a message to a cloud AI tool, that text travels from your device to a data center run by that provider. The model processes your input there and sends a response back. This is not a data security failure; it's just how cloud software works.

The question for a confidentiality analysis is what happens to that data once it's there.

Most major AI providers offer some form of data-retention opt-out. The standard consumer approach for tools like ChatGPT is: data submitted in conversations is not used to train the model if you opt out through account settings, but it may still be processed and temporarily retained on their infrastructure during inference. "Temporarily retained" means something specific: your input exists, in some form, on their systems during the time it takes to generate a response. It is not permanently stored after that window if you've opted out, but it was there.

Enterprise agreements tell a different story. OpenAI's Enterprise tier, Anthropic's AWS Bedrock offering, and similar enterprise contracts typically include data processing agreements with explicit commitments: no training on your data, data isolation during processing, audit rights. These agreements are designed exactly for the confidentiality analysis you'd need to do under Opinion 512. They're also priced for enterprise budgets, not solo practitioners.

So the realistic picture for a solo or small-firm practitioner using a standard commercial AI subscription: your data travels to the provider's servers, is processed there, and is generally not retained for training if you've enabled the opt-out. Whether that constitutes "reasonable efforts" to maintain confidentiality under your jurisdiction's rules is a real question. Some bar ethics opinions issued since Opinion 512 have started addressing it. Yours may have.

The point of this section isn't to tell you that cloud AI is dangerous. It's to describe what's actually happening so your confidentiality review is based on facts.

---

## The local-first alternative

There's a different architecture where this analysis mostly goes away. Local-first AI tools are built so that your documents never leave your machine during the AI workflow. You bring your own API key from Anthropic, OpenAI, or another provider. The request goes from your computer directly to that provider's API. The tool in the middle, the interface you're working in, never sees your files.

This isn't a new concept. It's just how non-cloud software has always worked. The novelty is applying it to AI-assisted document work.

The data flow looks like this: your machine calls the AI provider's API directly. The provider processes the request. The response comes back to your machine. The tool you're using is just an interface; it's not a relay. Your documents live in a folder on your hard drive. Your API key lives in your operating system's keychain. Nothing passes through a server you don't control.

This architecture sidesteps a meaningful portion of the confidentiality analysis. The question of "does sending this document to the provider constitute a disclosure?" still exists, but you've eliminated the additional layer of a software vendor in the middle. The analysis is simpler because the data path is simpler.

I built one of these tools. It's called Advisor Prep Hero, and it's at keepance.com. I'm mentioning it because it would be strange not to, and because I want to be upfront about my perspective. But local-first tools aren't a category I invented. Enterprise on-premises deployments of AI models are another approach entirely, and for large firms they may be the right answer. The point isn't to pick a winner. It's that there are architectures that remove the third-party data question from your analysis.

Tradeoffs worth naming: local-first tools using external API providers still send data to those providers during inference. You're not air-gapped. What you've done is reduce the number of parties involved. If you need complete air-gapping (because your engagement letter requires it, or because the sensitivity of the matter demands it), you'd want a truly local model running on your hardware without any external API call. That's a more complex setup and genuinely outside what most solo practitioners need.

---

## A note for patent practitioners

This section is short because the question is genuinely unsettled, and I don't want to overstate it.

Under the European Patent Convention, public disclosure of an invention before a patent application is filed can destroy patentability. This is the absolute-novelty principle. Patent practitioners already navigate this carefully: you don't publish before you file, and you're careful about what you show to whom.

The question of whether submitting an invention description to a cloud AI service constitutes "public disclosure" under the EPC is something patent attorneys are actively discussing. There is not, to my knowledge, a definitive ruling. But if you do prosecution work and you've been using cloud AI to help draft or analyze disclosures, it's worth a conversation with a European associate about the current state of thinking.

A local-first approach eliminates the question in the same way it does for attorney-client privilege: by removing the third-party data path. For practitioners doing prosecution work, that may be a more compelling reason to care about AI architecture than it is for general practice.

---

## What a competent confidentiality review actually looks like

I want to close with this, because I think it's the most useful thing in the piece.

The goal of a competent confidentiality review under Opinion 512 is not to avoid AI. It's to document that you understood what you were using and chose it thoughtfully. That's actually achievable.

For a cloud AI tool, reasonable documentation might include: a note in your file showing you reviewed the provider's terms of service and data practices, confirmation that you've enabled any available data-retention opt-out, and a record of what type of information you're comfortable processing through that tool versus what you won't. Some things are fine: publicly available case law, your own draft language, general legal research questions. Other things require more scrutiny: client intake information, privileged communications, confidential business details.

For a local-first tool, the review is simpler. The data path is shorter. But you still want to understand how the API key is stored and what happens during the actual inference call.

Practitioners who genuinely understand what's happening will make better decisions and will be able to explain those decisions if they're ever questioned. That's the real goal. Not fear of AI, and not blind adoption of it.

The tools exist. The analysis exists. You actually have what you need to make a real choice.

---

*Jameson Daines is a product designer and the developer of Advisor Prep Hero (keepance.com), a local-first AI workspace for attorneys, CPAs, and consultants working under confidentiality obligations. He is not an attorney. If you think he's gotten something wrong here, please let him know.*
