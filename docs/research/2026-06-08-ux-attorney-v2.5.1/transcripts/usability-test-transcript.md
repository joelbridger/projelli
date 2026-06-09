# Usability Test Transcript: Session 2 (Moderated, Think-Aloud)

| | |
|---|---|
| **Session** | 2 of 2 (Moderated Usability Test) |
| **Date** | 2026-06-08 |
| **Participant** | P1: Diane Marchetti, Owner/Principal Attorney, Marchetti Law LLC (Cleveland, OH) |
| **Moderator** | Dr. Lena Whitfield, Principal UX Researcher (fractional), Keepance |
| **Build under test** | Keepance v2.5.1 (signed desktop build) |
| **Method** | Moderated, task-based, concurrent think-aloud, screen-shared and recorded |
| **Environment** | Fresh install on participant's Windows 11 machine, clean test license, provided test AI API key available, test Microsoft 365 mailbox preloaded with realistic but NON-confidential messages, bundled legal sample workspace |
| **Duration** | ~60 minutes |
| **Note** | **SYNTHETIC Pass A.** This transcript is a rigorous synthetic session generated from the locked persona and protocol. It is not a recording of a real participant. It exists to pressure-test the instrument, seed the analysis template, and brief real-participant recruiting. Findings here are hypotheses to validate with real attorneys, not proof. |

Speaker labels: **LW** = Dr. Lena Whitfield (moderator). **DM** = Diane Marchetti (participant). Bracketed text = observed UI actions and moderator field notes.

---

## Pre-test setup and framing

**[0:00]**

**LW:** Diane, thank you for coming back. Good to see you again. Before we start I just want to re-confirm a couple of housekeeping things. You're okay with this being recorded, audio and screen, the same as last time?

**DM:** Yes, that's fine. Record away. I signed the thing.

**LW:** Perfect. And can you see your whole Keepance window on the screen? I want to make sure your screen share is showing me the entire application, not just a corner of it.

**DM:** [drags window, maximizes] There. It's filling the whole screen now. You can see the whole thing?

**LW:** I can see all of it. Thank you. So, today is going to feel a bit different from last time. Last time we just talked, I asked you about your world and how you work. Today you're going to actually drive. I'm going to give you some tasks, and you're going to do them in the software while I mostly stay out of your way.

**DM:** Okay. You're going to make me click around.

**LW:** I am. And here's the single most important thing I'm going to ask of you. Keep talking. The whole time. Tell me what you're looking at, what you're trying to do, what you expect to happen before you click, and especially tell me when something surprises you or annoys you or confuses you. Narrate it out loud, even when it feels completely unnatural. It will feel unnatural.

**DM:** It's going to feel like I'm talking to myself in the car.

**LW:** [laughs] That's exactly the right amount of weird. And to be very clear, because lawyers tend to take tests seriously: we are testing the software here, not you. There are no wrong moves. If you get stuck, that is genuinely the most useful thing that can happen in this whole hour, because it shows us a problem we need to fix. So don't be embarrassed by getting stuck. Lean into it.

**DM:** Noted. Although I'll tell you right now, if I get stuck, my instinct is going to be to say something unkind about whoever designed it. I bill in tenths of an hour. My patience for software is thin.

**LW:** I want that. Say the unkind thing. That's data too. One more thing, and this is the part that's going to test my self-control as much as yours. When you get stuck, I am not going to jump in and help right away. I'm going to sit here and let you figure out what you'd do on your own, because in real life I won't be sitting next to you. If at any point you'd actually give up and close the thing, tell me. "I'd quit here" is one of the most valuable sentences you can say.

**DM:** So you're going to watch me flail and not save me.

**LW:** For a while, yes. Eventually I'll help if you're truly stuck, and when I do I'll say so out loud for the record. But I'll make you sweat first. Last question before we start, just a baseline. Right now, before you've done anything, how are you feeling about this, one to seven, where seven is fully confident?

**[0:03]**

**DM:** [pause] Honestly? A four. Maybe a soft four. I'm not nervous, I'm just, I've been burned by software that promised to save me time and then ate an afternoon. And the last time I touched an AI thing I lay awake afterward worrying I'd handed my client's facts to a server in California. So I'm coming in a little arms-crossed.

**LW:** That's fair, and that's a really useful four. Let's keep an eye on whether it moves. All right. Let's start.

---

## Task 1: First run: get from install to a working workspace

**[0:04]**

**LW:** Here's the setup. You just downloaded and installed Keepance because a colleague mentioned it. You're a litigator, the way you really are. Go ahead and get yourself set up the way you'd want it for real, and talk me through everything you see. I want you to get to the point where you feel you could actually start working. Whenever you're ready.

**DM:** Okay. So I'm going to double-click this. [double-clicks Keepance icon on desktop] Here we go.

[Application launches. FirstRunWizard opens to the Welcome screen.]

**DM:** All right. It opened. There's a, it's a clean screen. It says "Welcome to Keepance." And underneath, "Local-first AI workspace for confidential client work." And then, "Your files stay on your machine." [reads aloud, slows down] Huh. Okay. "Your files stay on your machine." That's, that's the thing I care about, so they're leading with it. Good. I'll give them that. Whether it's true is a different question, but at least they know what I'm afraid of.

**LW:** Say more about that reaction.

**DM:** Well, that one line is doing a lot of work for me. "Your files stay on your machine." That's the opposite of what I assume about every app now. I assume everything I touch is being slurped up into somebody's cloud. So if they're telling me up front that it doesn't, that's either honest or it's marketing. I'm reserving judgment. But it lowered my shoulders about half an inch. There's a button that says "Get Started." I'm going to click it.

[Clicks "Get Started." Wizard advances to the Profession picker, four cards.]

**[0:06]**

**DM:** Okay, now it's asking me what I do. There are four, four cards. "Legal practice." "Tax and accounting." "Consulting and strategy." And "Something else." [hovers over each] Well, that's easy. I'm a lawyer. [clicks "Legal practice"]

**LW:** What made that easy?

**DM:** Because it's in my language. It didn't ask me to "select a workspace template" or "choose a vertical." It said, what do you do, and one of the answers is the thing I am. I clicked Legal practice because I practice law. There's nothing to decode. I like when software talks like a person instead of like a spreadsheet. [card highlights, "Continue" button activates] And it lit up and there's a Continue button. Clicking it.

[Clicks "Continue." Wizard advances to the Workspace step.]

**[0:07]**

**DM:** Now it says, "Choose your workspace." And there's a button, "Pick a folder." And some text. Let me read it. [reads aloud] "Your workspace is a folder on your computer where Keepance keeps your files. You can pick an existing folder or make a new one." [pause, 5 seconds]

**DM:** Hmm. "Workspace." See, "workspace" is one of those words. When an app says "workspace" my brain goes, uh oh, is this a thing I have to live inside now, is this another Slack, another portal, another place I have to log into and learn. I've got Clio, I've got Outlook, I've got the NAS. I do not want another "workspace." [longer pause, 6 seconds, re-reads the screen]

**DM:** But, wait. It says it's a folder. "A folder on your computer where Keepance keeps your files." So, it's, it's just a folder? Like a regular folder, on my actual computer?

**LW:** What are you thinking right now?

**DM:** I'm thinking, if "workspace" is just their fancy word for "a folder on my hard drive," then I actually understand this completely and I was worried about nothing. That's, okay, that's a relief. Because folders I get. I have four hundred of them, organized by matter, sort of. So this is just telling me, point me at a folder and I'll put stuff there. Fine. I'd, in real life I'd probably make a new one so it's clean and not mixed in with my matter files. Let me click Pick a folder.

[Clicks "Pick a folder." Native OS folder picker opens.]

**DM:** Okay, the regular Windows folder thing came up, the one I know. Good, this is familiar. I'm going to make a new folder. [navigates, clicks New folder, types "Keepance Test"] I'll call it Keepance Test for now. [selects folder, clicks Select Folder]

[Folder picker closes. Wizard shows the selected path and a "Continue" button.]

**DM:** And it's showing me the path, C colon, Users, Diane, Keepance Test. That's, yes, that's where I put it. Okay. I like that it showed me the actual path. It's not hiding where my stuff goes. Continuing.

**LW:** Before you continue, let me ask. A second ago you tensed up at the word "workspace," and then you relaxed when you realized it meant a folder. If you'd never read that explainer text, what would you have thought "workspace" meant?

**DM:** Oh, something cloudy. Something I log into. A website with my files held hostage on it. The word "workspace" to me sounds like a place that belongs to the software company, not to me. The folder, that belongs to me. So that one sentence under the button is the only reason I'm not annoyed right now. If it had just said "Choose your workspace" with a button and no explanation, I'd have been suspicious. Honestly I'd want them to just call it a folder. "Pick a folder for your files." Done. Why make me translate.

**LW:** Got it. Go ahead and continue.

[Clicks "Continue." Wizard advances to the API key step. Screen shows a heading, a plain-English explainer paragraph, three provider options (Claude / OpenAI / Gemini), a text field, a "Test this key" button, and a "Skip for now" link.]

**[0:10]**

**DM:** Okay. Now. [pause] Now it says "Connect an AI provider." And there's, there's a box that wants something called an "API key." [long pause, 9 seconds, leans toward the screen]

**DM:** I, okay. I don't know what that is.

**LW:** [silent, waits]

**DM:** [reads the field label aloud] "API key." [pause] An API key. I've seen that phrase. I have no idea what it is or where I would get one. This is, see, this is the kind of thing. [frowns] This is exactly the moment where, if I were home at nine o'clock at night trying to do this myself, I would start to lose patience. Because it's a, it's a developer word. It's the kind of word that assumes I have an IT department. I don't have an IT department. I have me.

**LW:** [silent, waits, 8 seconds]

**DM:** [exhales] Okay, but let me not be a baby about it and actually read what's on the screen instead of just reacting to the scary word. [leans in, reads the explainer aloud]

**DM:** "An API key is how Keepance talks to the AI on your behalf. It's like a password from the AI company, Claude, OpenAI, or Google, that lets this app use your account. You paste it in once. Your key stays on your machine, in your computer's secure keychain. Keepance never sees it and never charges you for AI. You pay the AI company directly for what you use." [pause]

**DM:** Hm. Okay. So. [pause] So an API key is, it's like a password the AI company gives me, and I'm pasting it in so the app can use the AI as me. And, and the part that matters, "you pay the AI company directly." So I'm not paying Keepance for the AI part. I'm paying, OpenAI or whoever, directly. [pause] That's, okay. That's actually clearer than I expected. The "it's like a password" line helped. I get passwords.

**LW:** What's your reaction to that explanation?

**DM:** It's, it's better than nothing, I'll say that. The "it's like a password from the AI company" part is the part that landed. Because I was staring at "API key" thinking it was some technical certificate thing I'd have to generate in a command line, which I have never opened in my life. The fact that they explained it in two sentences I could actually parse, that's, that's the difference between me quitting here and me continuing. [pause] But I'll be honest, I still don't know how to get one. It tells me what it is. It doesn't fully tell me, like, walk me to the place where I get the thing. There's three options, Claude, OpenAI, Gemini. I don't know which one I'm supposed to pick. I don't know the difference. I'm a lawyer, not a, whatever you people are.

**LW:** What would you do next if I weren't here?

**DM:** [pause] If you weren't here? Honestly, at home, at nine at night, with a brief due? There's maybe a sixty percent chance I close this and say "I'll deal with it later," which means never. The other forty percent, I'd, I'd probably click on, is there a link? Let me look. [scans the screen, hovers over a "How do I get a key?" link] There's a little link, "How do I get a key?" I'd click that and pray it doesn't take me to a wall of documentation. Should I click it?

**LW:** Do whatever you'd really do.

**DM:** [clicks "How do I get a key?"] 

[A help panel/popover expands inline showing brief steps and a deep link button per provider.]

**DM:** Oh. Okay, it didn't take me to a separate website, it just opened a little, a little panel right here. And it says, for each one, "Create an account, copy your key, paste it here," and there's a button that says "Open Claude's key page." So it would, it would walk me out to the website and back. [pause] That's, that's less scary than I thought. It's still more steps than I want at nine at night, but it's, it's a path. I can see a path. Okay. For today, you mentioned I have a test key I can use?

**LW:** I did. I'll give you a test key you can paste in, since I don't want you creating real accounts during a recorded session. Here it is. [provides test key]

**DM:** [Note: assist provided. Moderator supplied the test API key so the participant could proceed. This converts Task 1 to assisted. The comprehension struggle preceding the assist is the finding, not the key handoff.] Okay. Pasting it in. [pastes key into the field] And there's a button, "Test this key." I'm going to, yeah, I'm going to click that, because I do not trust that I did it right and I want it to tell me before I move on.

[Clicks "Test this key." Brief spinner. A green check and "Key works. You're connected to Claude." appear.]

**[0:13]**

**DM:** Oh. [small smile] Okay. It thought about it for a second and then it gave me a green check and it says, "Key works. You're connected to Claude." [pause] You know what, that, I like that button. A lot, actually. Because the thing I hate most is when you fill something in and you have no idea if it took, and then three screens later it blows up and you don't know what you did wrong. This told me right now, before I committed to anything, that it worked. That's, that's respectful of my time. That's the first thing in this setup I'd actually compliment.

**LW:** Good. So what would you do now?

**DM:** There's a Continue button, now that it's green. I'll click it. [clicks "Continue"]

[Wizard advances to the optional demo workflow step.]

**DM:** Now it's offering me, "Want to see a sample workflow?" And a "Show me" button and a "Skip" link. Um. [pause] I'm, in real life I'd be impatient and skip this, I want to get to my folder. But you want me to look at things, so, let me, actually no. Let me be honest about what I'd really do. I'd skip it. I want to get to the part where I can actually work. I can come back to a demo. [clicks "Skip"]

**LW:** That's the right call, do what you'd really do.

[Wizard advances to the final "Done" step. Checkbox "Populate workspace with sample files" is checked ON by default.]

**[0:14]**

**DM:** Okay, last screen, I think. It says "You're all set." And there's a checkbox, it's already checked, "Populate workspace with sample files." [pause] And it says these would be example legal files so I can see how things look. Hm. Do I want sample files in my folder? [pause] You know what, yeah, for now, leave it checked. I'd rather see what their stuff looks like than stare at an empty folder wondering what I'm supposed to do. I can delete them later. So I'll leave that checked and, there's a "Finish" button. Clicking it.

[Clicks "Finish." Wizard closes. The main application loads with the legal sample workspace populated. A 10-step FeatureTour begins, highlighting the first sidebar tab.]

**[0:15]**

**DM:** Oh, okay, now it's, it's loaded the actual app, and there's some files on the left, I can see, "Sample - Client Intake," "Sample - Matter Overview," a few of those. Good, those are the sample ones. And now it's, there's a little, it's pointing at things. It's giving me a tour. It's highlighting a thing on the left and it says "Files. Your documents live here." Okay. And there's a Next button. [clicks Next] "AI. Chat with AI about your work." [clicks Next] "Workflows. Templates for common tasks." Okay, I'm just, I'm going to click through these. [clicks Next several times] Search, Research, Whiteboard, Audit. [clicks through the tour] Okay. There's a, it's done. It said that's the tour.

**LW:** What's your read on that tour?

**DM:** It was fine. It was fast, which I appreciated. Seven little tabs down the side, Files, AI, Workflows, Search, Research, Whiteboard, Audit. Honestly I clicked through it faster than I read it, which means I'll have forgotten half of it in thirty seconds, but it didn't make me sit through a ten-minute video, so, fine. I'd rather poke at it myself. I can see the files on the left, there's a thing for AI, there's workflows. I feel like I could start clicking around. So, yeah, I think I'm, I think I'm set up?

**LW:** Let me ask you that directly. Do you feel like you've reached the point where you could start working?

**DM:** Yeah. I'd say so. I've got my folder, I've got, the AI thing apparently works because it gave me the green check, and there's sample files to look at. So yes. I'd call this set up. It took longer than I'd like, and that API key part nearly lost me, but I got here.

**LW:** Okay. I want to do a quick check, and this is not a trick, it's just to understand what stuck. In your own words, the files that are in this app right now: where are they, physically, and who can see them?

**[0:17]**

**DM:** [pause] Where are they. They're, well, they're in the folder I made. Keepance Test, on my C drive. So, on my computer. That part I'm, I'm fairly confident about, because it made me pick the folder and it showed me the path. So my files are on my machine. [pause]

**LW:** And who can see them?

**DM:** [longer pause, 7 seconds] Me. I'd say, just me, they're on my computer. [pause] Although. Hm. Now you've got me second-guessing. There's this AI thing in here, and I gave it that key. So when I use the AI, is, is my stuff going somewhere then? I, I think the files sit on my computer, but when I ask the AI a question, something goes out to, to Claude, right? Because that's where the AI lives. So I guess, the files live with me, but the AI part talks to the outside. I think. I'm honestly not a hundred percent sure where the line is.

**LW:** Tell me more about the uncertainty.

**DM:** It's, okay, here's my problem. There's two things and I can't cleanly tell them apart. There's "my documents are stored on Keepance's computers somewhere" versus "my documents are on my computer but my questions get sent out to the AI." Those are really different things for me, ethically. The first one is, my client's files are sitting on some company's server, that's the thing that keeps me up at night. The second one is, a specific question I asked got sent to an AI to answer. Both involve "something leaving," but they're not the same animal. And right now I, I couldn't swear to you which one this is. The folder thing makes me think my files are mine. But that green check, when I tested the key, that means it phoned out to Claude. So something connects to the outside. I just don't know what, exactly, or when.

**LW:** And the money side. A moment ago you read that you pay the AI company directly. Where does that leave you on who you're paying?

**DM:** [pause] So, the screen said I pay the AI company, not Keepance, for the AI. So I think I, I bought, or will buy, Keepance once, the software, and then the AI usage I pay, OpenAI or Claude, separately. [pause] I think. Honestly that's the part I'd want spelled out on, like, a single screen with small words, because "you pay them separately" is exactly the kind of thing where I get a surprise bill and I'm furious. So intellectually I read it and it made sense in the moment, but if you asked me to bet money on whether I've got it exactly right, I'd hesitate. I half-think there might be some way my stuff is "in the system somewhere," and I couldn't tell you why I think that, I just have a residual nervous feeling about it.

**LW:** That's really useful, thank you. That residual nervous feeling is exactly the kind of thing I'm listening for. Last thing for this task. On a scale of one to seven, where seven is very easy and one is very difficult, how easy or difficult was it to get yourself set up just now?

**[0:19]**

**DM:** [pause] I'd give it a four. A four out of seven. And the whole reason it's not higher is that API key wall. Everything else, the folder, the profession cards, the green-check button, that was, that was honestly smoother than I braced for. But there was a real moment in the middle where I almost bailed, where I'm staring at "API key" with no idea what it is, and at home with nobody next to me there's a real chance I'd have closed it. The explainer caught me, barely. So, four. Usable, but it nearly lost me at the one step that matters for whether I ever actually use the AI.

**LW:** Thank you. [Field note: Task 1 = Success (assisted). Assist = moderator-supplied test key after sustained stall at API key step; comprehension struggle is the substantive finding. SEQ 4/7. Time band: slow. Workspace-as-folder confusion brief and self-resolved via inline explainer (communication gap, severity 2). API key step is the documented #1 drop-off, confirmed: severity 3 to 4, communication gap, partially mitigated by explainer + test-key button but not resolved. Post-task comprehension check reveals PARTIAL mental model: correct that files are local, but cannot cleanly separate "data stored on vendor servers" from "prompt sent to provider," and is fuzzy on payment. Residual "in the system somewhere" belief = severity 4 liability-class finding.]

---

## Task 2: Produce a real deliverable: run a legal workflow and get it into Word

**[0:20]**

**LW:** Let's do something more concrete. Here's the scenario. A new client just came in. You want to turn your intake notes into a clean intake summary, and ultimately you need it as a Word document, the kind you'd put on your letterhead. Use Keepance to do that, and talk me through it.

**DM:** Okay. A new client intake into a Word doc. That's, that's a real thing I do, so good. Um. Where would I, okay. There was a tab called Workflows. That sounds like where the "do a task" stuff is. Let me click that. [clicks "Workflows" in the sidebar]

[Workflows tab opens. Shows the Legal Practice Pack templates as cards: Client Intake Synthesizer, Case Timeline Builder, Deposition Contradiction Finder, Privilege Log Drafter, Discovery Document Triage. A "verify citations before relying" banner is visible on the research-oriented templates.]

**DM:** Oh, okay, there's a, there's a list of these. [reads aloud] "Client Intake Synthesizer." "Case Timeline Builder." "Deposition Contradiction Finder." Ooh. "Privilege Log Drafter." "Discovery Document Triage." [pause] Okay, hang on, these are, these are actual things lawyers do. Whoever wrote these list has talked to a litigator. "Deposition Contradiction Finder," that, that's the legal-pad-and-sticky-tabs nightmare I told you about last time. I'm going to look at that later for sure. But right now I want the intake one. "Client Intake Synthesizer." That's the one for what you asked. Clicking it.

**LW:** Before you click, what do you expect to happen?

**DM:** I expect, honestly I don't know. I expect either it's going to ask me to upload my notes, or it's going to give me a blank box, or, I don't know. I'm hoping it doesn't just dump me into a chat where I have to know the magic words. Let me find out. [clicks "Client Intake Synthesizer"]

[The Client Intake Synthesizer opens as an InterviewForm: a sequence of numbered questions with text fields.]

**[0:22]**

**DM:** Oh. Oh, okay. It's, it's asking me questions. Numbered questions. "One. Client name and contact information." "Two. What brings the client in, in their own words." "Three. Key dates and deadlines mentioned." [pause, brightens] Oh, this is, this is just an intake questionnaire. I get this. This is the thing I make my paralegal fill out. This is, okay, this I understand completely. It's a form. I answer the questions, it does, something. Yeah. This is, this is the most comfortable I've felt in this whole app so far.

**LW:** What is it about this that's comfortable?

**DM:** Because it's not asking me to be clever. It's not a blank chat box where I have to figure out how to talk to a robot. It's asking me specific questions in an order that makes sense for an intake, and I just answer them like I'd answer a client intake. It mapped onto something I already do. That's, that's exactly right. Okay, let me fill it in like it's a real intake. [begins typing in field 1] Client name, let's say, Robert Keller. Phone, I'll put a number. [types] Number two, what brings them in. [types] "Client was terminated three weeks after reporting safety violations to OSHA. Believes it's retaliation. Wants to know if he has a case." [continues] Number three, key dates. [types] "Termination date, reported to me as roughly March, says he made the OSHA complaint in January." [continues filling fields] Okay, I'm, I'm filling these in. There's a few more. [types through remaining fields] Statute of limitations concerns, parties, prior counsel, none. Okay. There's a button at the bottom, "Generate." That, I assume that's the go button. Clicking it.

[Clicks "Generate." A streaming indicator appears; text begins generating in real time into a document view. The view shows raw Markdown.]

**[0:24]**

**DM:** Okay, it's, it's thinking. There's a little, it's typing it out live, I can see it writing. That's kind of, okay, that's kind of satisfying actually, watching it go. [watches, 10 seconds] Okay it's, it's producing something. There are headings. "Client Overview." "Summary of Claim." [reads] Hm. Okay wait. What is, why are there these, there's like, pound signs? And there's these little stars around words. [points at screen] What is, hold on. [pause, frowns]

**LW:** What are you looking at?

**DM:** It wrote me something, and it looks, it looks reasonable, the words are right, but it's covered in, in symbols. There's hashtag, pound-sign things before the headings, like "pound pound Client Overview," and there's double asterisks around, around bolded things, "star star Robert Keller star star." It looks like, it looks like code. Like something a programmer would look at. [pause] This is, see, this is the thing. This nearly undoes the good feeling I just had. A second ago I felt great because it was a nice form. Now it gave me back something that looks like, like source code with my client's intake buried in it. I can't hand this to anybody. This isn't a document, this is, this is a developer thing.

**LW:** [silent, waits, 7 seconds]

**DM:** [pause] Okay. Let me, let me assume they're not idiots and there's a way to make this look normal. There's, there's some buttons up at the top of this panel. Let me look at what's up here. [scans the top of the document panel, hovers over icons] There's, there's some little icons. One looks like an eye? Or, there's, hm. [hovers] Let me hover. One says, "Preview." [pause] Preview. Okay, "preview" usually means "show me what it really looks like." Let me click that and see. [clicks the Preview/rendered view toggle]

[The view switches from raw Markdown to a rendered/preview view. Headings render as styled headings, bold renders as bold, the document reads as a formatted memo.]

**[0:26]**

**DM:** Oh. Oh, okay. There it is. Now it looks like, now it looks like an actual document. The headings are headings, the bold is bold, the symbols are gone. [pause] Okay, so the symbol thing was just, that was the, the under-the-hood version, and this is the real-people version. [exhales] Okay. That's, that's a relief, but I'll tell you, I clicked into "preview" half on a guess. If I hadn't found that I would have concluded this thing produces gibberish and I'd have written it off. The default view, the one it dumped me into, that one made me think "this isn't for me." The fact that the nice version was one click away, fine, but it was defaulting to the scary one. I'd never want to see the symbol version unless I went looking for it.

**LW:** That's a really important distinction. Let me make sure I understand. You're saying the content was fine, but the way it was first shown to you read as "code, not a document."

**DM:** Exactly. The content was, honestly the content's pretty good. Let me actually read it now that I can. [reads the rendered draft aloud, scanning] "Client Overview. Robert Keller, contacted the firm regarding a potential retaliation claim." "Summary of Claim. Mr. Keller reports he was terminated approximately three weeks after filing a complaint with OSHA." Okay. It, it pulled the dates I gave it, it organized it the way I'd organize an intake memo, it even flagged, look, there's a section, "Potential Issues to Confirm," and it lists, "confirm exact termination date," "confirm date and method of OSHA complaint," "assess statute of limitations." [pause] That's, that's actually, that's a competent first pass. I wouldn't send it as-is, obviously, it's a robot, but as a first draft to react to? That saved me the staring-at-a-blank-page part, which is the worst part. Yeah. I'd, I'd take this as a starting point.

**LW:** Would you change anything in it before you used it?

**DM:** Sure, I'd tighten the language, I'd add my own assessment, I'd, the robot's being very, "potential, possibly, may." I'd make it sound like me. Can I, can I edit it right here? Let me see if I can just, click into it and change a word. [clicks back into the editor view, places cursor, types a small edit] Yeah, okay, it let me type. Okay so I can edit it. It feels, it feels like typing in, I don't know, a simplified Word? It's, it's fine. It's not Word, but it's a text editor, I can change things. That's fine for a first draft. I don't need it to be Word, I need it to become Word, which is your actual question. So, how do I get this into Word.

**[0:28]**

**DM:** Okay. How do I get this into a Word document. Let me look for, an export, or a, "Save as," or a, something. [scans the top of the panel] There's the buttons up top, there's the preview one, there's, [hovers over icons] there's something that looks like, a download arrow? Let me, no. Hm. [pause] Let me look for a menu. Usually there's a, three dots, or a File menu. [scans the screen edges, hovers over the document panel header] [long pause, 11 seconds]

**LW:** What are you thinking?

**DM:** I'm thinking, I know it can do this, because the whole pitch was "get it into Word," so it has to be in here somewhere, but it's not, it's not where I'd expect it. I'd expect a big obvious "Export to Word" button right next to the document, or a File menu at the top like every program I've used since 1998. There's, I'm not seeing an obvious "export." [hovers over the download-looking icon] Let me click this arrow thing and see what it does. [clicks the icon]

[A small menu appears with options including "Export as Word (.docx)", "Export as PowerPoint (.pptx)", "Export as PDF", "Copy as Markdown".]

**DM:** Oh. There it is. It was, it was hiding behind this little arrow icon. "Export as Word, docx." "Export as PowerPoint." "Export as PDF." [pause] Okay, so it was here the whole time, it was just behind an icon I didn't recognize. I was looking for the word "export" or a "File" menu, and instead it's this little, I don't even know what that icon is supposed to be. But, fine, found it. This is, I'll say it, this is the kind of thing where if I were alone I'd have spent two or three minutes hunting and gotten annoyed. Found it eventually, but it was buried.

**LW:** [Field note: brief assist threshold approached but not crossed. Participant located export independently after ~30 seconds of hunting. No verbal hint given. Counted as unassisted on the export sub-step, though slow. Export discoverability = the finding.] So you found it on your own. What would have made that faster?

**DM:** A button. A button that says the word "Export," in words, near the document, where my eye goes. Not an icon I have to decode. Lawyers aren't going to hunt. I almost gave up and I knew it had to be there. Anyway. Let me click "Export as Word." [clicks "Export as Word (.docx)"]

[A save dialog appears, defaulting to the workspace folder. Participant accepts the default filename and location.]

**DM:** Okay, it's asking me where to save it, it defaulted to my folder, that's fine, I'll keep the name, "Robert Keller Intake Summary," and save. [clicks Save]

[A toast notification appears: "Exported. Open file?"]

**DM:** And it says "Exported, open file?" Yes, I want to open it, I want to see if it's real. [clicks "Open file"]

[Microsoft Word launches and opens the exported .docx.]

**[0:31]**

**DM:** [pause, watches Word open] Okay. Word is opening. Come on. [Word document renders] Oh. [pause, genuine] Okay. That's, that's a real Word document. The headings are Word headings. The bold is bold. It's, it opened in actual Word, and it looks like a document I made. [scrolls through it in Word] I could, I could drop my letterhead on this right now and it would look like a Marchetti Law intake memo. [pause] Okay. I'll be honest, I didn't expect that to work as cleanly as it did. I expected it to come out looking like garbage, with weird formatting, the way things do when they come out of other programs. But this is, this is clean. This is a real document.

**LW:** Tell me about that reaction.

**DM:** Well, you have to understand, my whole thing is, "if it isn't in Word with my letterhead, it isn't a real document." I said that to you last time. And I half-expected this to fail that test, because everything that comes out of some other app into Word is a formatting disaster, the spacing's wrong, the fonts are weird, I spend ten minutes cleaning it up. This one, it came out looking like I made it in Word in the first place. So that, that actually, that moved me a little. Because that means the path is real. Form, to draft, to a Word doc I'd actually put my name on. That's the whole job. [pause] The two complaints I have are, one, the symbol-version thing scared me before I found preview, and two, the export was buried behind a mystery icon. But the actual, the actual outcome? Yeah. That's, that's a real deliverable. I'm a little impressed and I don't impress easy.

**LW:** That's great. Let me ask the ease question for this task. One to seven, seven is very easy. Producing that intake summary and getting it into Word.

**[0:33]**

**DM:** [pause] I'll give that a five. Five out of seven. It's higher than the setup because the actual meat of it, the form and the result, that was genuinely good, the form clicked with me immediately and the Word doc at the end was the real thing. The two points I'm docking are for the, the moment the draft looked like code before I found preview, that rattled me, and for having to hunt for the export. Both of those are, those are findable-once-you-know problems, but I shouldn't have to know. So, five. The destination was great. The road there had two potholes.

**LW:** Thank you. [Field note: Task 2 = Success (assisted-adjacent, effectively unassisted). SEQ 5/7. Time band: expected-to-slow. Strong delight at InterviewForm ("oh, this is like an intake questionnaire, I get this") = the intake-form model maps cleanly to existing mental model. Raw Markdown default view read as "code/a developer thing," severity 3, communication/IA gap; rendered view recovered it but is not the default and toggle icon not obvious. Export to Word is BURIED behind an unlabeled icon, severity 3, communication/IA gap (capability exists and works well). Final .docx quality cleared her "real document" bar and produced genuine, slightly grudging delight, an important positive. Editing-in-place accepted as "a simplified Word," adequate.]

---

## Task 3: Connect email and understand what just happened

**[0:34]**

**LW:** Now we get to the feature your colleague supposedly raved about, the email one. You're on Microsoft 365, the way you are in real life. For today we're using a test mailbox, not your real one, with made-up non-confidential messages in it, because I never want your real client mail on a recorded call. So: connect your email so you can search it later. And as you go, the most important thing, keep telling me what you think is happening to your email.

**DM:** Okay. Connect my email. This is, this is the one I actually care about, because email is my whole life and I can't find anything in it. So if this does what you're implying, this is the part I'm here for. Um. Where would I connect email. It's not, it wouldn't be in the file area. It's probably a, a setting. Let me find settings. There's usually a gear. [scans the sidebar and window] There's a little gear at the, down at the bottom. [clicks the Settings gear]

[Settings opens. A left-hand settings navigation includes "Integrations" among other sections.]

**DM:** Okay, settings opened, and there's a list on the left. [reads] "General." "AI Providers." "Integrations." [pause] "Integrations." That sounds like where you connect other stuff. Email's another thing I'd connect. Let me try Integrations. [clicks "Integrations"]

[The Integrations panel shows "Microsoft 365" with a "Sign in with Microsoft" button and a short description noting read access and local encrypted storage.]

**[0:36]**

**DM:** Okay. "Microsoft 365." Yeah, that's me. And there's a "Sign in with Microsoft" button. And some text under it, let me read it. [reads aloud] "Connect your Microsoft 365 mailbox so you can search and ask AI about your email. Keepance imports the folders you choose, stores them encrypted on this computer, and never uploads your mail to Keepance's servers. Read-only for now." [pause]

**DM:** Okay. "Stores them encrypted on this computer, never uploads your mail to Keepance's servers." That, that's the sentence I needed to read. Whether I believe it is another matter, but they're at least claiming the thing I'd need them to claim. And "read-only for now," good, I don't want it sending email as me, God no. Okay. Let me click "Sign in with Microsoft." [clicks "Sign in with Microsoft"]

[A device-code dialog appears in-app: a code (e.g., "GXKR-7TQM"), instructions to go to microsoft.com/devicelogin, a "code expires in 15 minutes" line, and an "Open browser" button.]

**[0:37]**

**DM:** [pause] Okay, this is, hm. It's, it gave me a, a code. "GXKR-7TQM." And it says, "Go to microsoft.com/devicelogin and enter this code." And there's a thing, "code expires in 15 minutes," and an "Open browser" button. [pause, frowns slightly] Why is it, why is it giving me a code? Why isn't it just, why doesn't it just ask for my email and password right here?

**LW:** [silent, waits]

**DM:** [pause, 6 seconds] I mean, I don't, this is a little, this is making me nervous in the way that, you know how sometimes a screen gives you a code and you can't tell if it's legitimate or if it's one of those scam things where they tell you to type a code somewhere? I get warnings from the bar about that stuff. [pause] But, okay, it says microsoft.com/devicelogin, and that's, that's a Microsoft address, and I'm the one who clicked "sign in with Microsoft," so. I think this is just how Microsoft does the login. It's, it's going to send me to Microsoft's own page to type the code, so that Keepance never sees my password. [pause] Actually, wait, that's, if I think about it that way, that's, that's kind of good? It means I'm not typing my Microsoft password into this app, I'm typing it into Microsoft. Okay. I think. Let me click "Open browser" and see.

**LW:** What made you land on "this is probably fine"?

**DM:** The Microsoft address, and the fact that I started this. If a random app had popped this up out of nowhere I'd have slammed the laptop shut. But I clicked "sign in with Microsoft," so a Microsoft login flow showing up is, that tracks. And the part about not typing my password into Keepance directly, the more I think about it the more I actually prefer that, I just, the code thing threw me for a second because it's not what I'm used to. I'm used to a username and password box. Okay. Opening the browser. [clicks "Open browser"]

[A browser window opens to microsoft.com/devicelogin.]

**DM:** Okay, a browser window opened, and it's Microsoft's page, asking for the code. [the code may be pre-filled or she types it] Okay it, it actually carried the code over for me, I just have to confirm it. [confirms the code] And now it's, it's asking me to sign in to my Microsoft account. [signs into the test M365 account] Okay, signing in with the test account you gave me. [completes sign-in]

[A Microsoft consent screen appears, listing the permissions Keepance is requesting, e.g., read access to mail.]

**[0:39]**

**DM:** And now there's a, a permissions screen. Microsoft's asking me, "Keepance wants to: read your mail." [reads] And it lists, "Read your mail," and "maintain access to data you've given it access to." [pause] Okay. So it's telling me exactly what it's asking for. "Read your mail." Not, not "read and send," not "delete," just read. Which matches what the app said, read-only. Okay, I, that, that consistency actually helps. The app said read-only, and now Microsoft's confirming it's read-only. If the app had said read-only and then Microsoft asked for permission to send and delete, I'd be out. But they match. So I'll, I'll accept. [clicks Accept]

[The consent screen confirms, and the browser shows a "you can return to the app" message.]

**DM:** Okay, and now it says I can go back to the app. [switches back to Keepance]

[Back in Keepance, the device-code dialog has resolved. A folder/scope selection screen now appears, listing mailbox folders with checkboxes, e.g., Inbox, Sent Items, specific subfolders, with a note about what will be imported.]

**[0:40]**

**DM:** Okay, I'm back in Keepance and it, it knows I'm signed in now. And now it's, oh, this is good. It's showing me my folders and asking me which ones I want to bring in. [reads] There's checkboxes. "Inbox." "Sent Items." And then some, some subfolders, looks like the test account has a couple. And it says, "Choose which folders to import. You can change this later." [pause] Okay. I like this. I like this a lot, actually. It's, it's not just grabbing everything, it's letting me choose. Because in real life, my mailbox has, has stuff I would not want anywhere near an AI, personal things, HR things, stuff that isn't client matters. The fact that I can say "just bring in these folders," that's, that's control. That's the kind of control I need to even consider this.

**LW:** Say more about why that control matters to you.

**DM:** Because "import all my email" would terrify me. My whole mailbox is twenty years of everything. If a tool said "I'm going to suck in your entire mailbox," I'd say absolutely not, there's stuff in there I can't have leaving my sight, even to my own hard drive in a pile I don't control. But "pick the folders," that means I can scope it to, to just what I want, just the matter folders, and leave the rest alone. That's the difference between "no" and "maybe." For today, the test account, let me just, I'll take Inbox and Sent. [checks Inbox and Sent Items] That's, those are the ones with the client emails you set up, right? [proceeds] Okay. There's a button, "Start import," or, "Sync." [clicks the sync/import button]

[A background sync begins. A progress bar appears with a count, e.g., "Importing 142 of 380 messages," and "Stop" and (later) "Resume" controls. An encryption indicator or note may be visible.]

**[0:42]**

**DM:** Okay, it's, it's doing it. There's a progress bar. "Importing, 140-something of, of three hundred eighty messages." And it's, it's climbing. And there's a "Stop" button, so I could stop it if I needed to. [watches] Okay, that's, it's reasonably quick. [pause] There's a little, there's a line down here, let me read it. [reads] "Your mail is being encrypted and stored on this computer." Okay. So it's telling me, while it's doing it, that it's encrypting. Good. That's, that's the reassurance I want to see, although, I'll come back to that, because "it says it's encrypting" and "I understand what that means for me" are two different things. [watches progress complete] Okay, it finished. It says, "Import complete. 380 messages." And it's, the folders are showing up now.

**LW:** [Note: in this build a one-line disk-encryption nudge may appear if BitLocker is off. On this test machine BitLocker is on, so no nudge shown. Participant not exposed to that signal this session; flag for a session where it does appear.] Before we go on, I want to do the comprehension check again, because this is the part that matters most for your world. Walk me through what just happened to your email. Where is it now? Could Keepance read it? Could the AI?

**[0:44]**

**DM:** [pause] Okay. Where is it. It, it pulled my email, the folders I picked, Inbox and Sent, and it, it put them, here. On this computer. In, in that folder, or near it. So my email is now, there's a copy of it on my machine. That part I'm, I'm fairly solid on, because it made me pick folders and it showed me a progress bar of it coming down onto my computer, and it said "stored on this computer." So, mail is on my machine now. Good.

**LW:** And could Keepance, the company, read it?

**DM:** [pause, 5 seconds] I, the screen said it never uploads to Keepance's servers. So, going by what it told me, no, Keepance the company can't read it, because it never went to them, it came straight from Microsoft to my computer. [pause] I, I think that's right. That's what it said. Do I, do I know that in my bones? No. I'm taking their word for it. But that's what they're claiming, that it went Microsoft-to-me and didn't stop at their place.

**LW:** And the AI? Could the AI read it?

**DM:** [longer pause, 9 seconds] Hm. That's, that's the one I'm fuzzy on. So. The email's on my computer. But the whole point, you said, is I can ask the AI about it. So for the AI to answer me, the AI has to, has to see it, right? So does that mean, when I connected the email, did the AI already, like, read all of it? Or does it only see the specific one when I ask about something specific? [pause] I, I genuinely don't know. And that, that actually matters to me a lot. Because "the AI read one specific email to answer one specific question I asked" is very different from "the AI ingested my entire mailbox." The first one I might be okay with. The second one, that's, that's the thing I'm scared of.

**LW:** Tell me more about that distinction.

**DM:** It's the same problem I had before, with the files. There's a difference between, the data is sitting on my machine encrypted, just sitting there, versus, the data got sent out to the AI company. And I can't, from what I've seen, I can't tell you which happens or when. It encrypted it on my computer, fine, I believe that, sort of. But the moment I ask the AI a question about it, something has to happen, and I don't know if that "something" is "a tiny piece goes out to Claude to answer this one question" or "it already sent everything out to build some kind of, index, when I connected." [pause] And here's the thing. For me, that's not a nice-to-know. That's, that's the whole ballgame. If I can't explain to a worried client exactly where their email is and who saw it, I can't use this. Because the first thing a sophisticated client is going to ask me is, "Diane, where is my stuff, and did you give it to an AI?" And right now, after doing this, I, I couldn't give them a clean answer. I'd be hand-waving. And lawyers can't hand-wave about confidentiality.

**LW:** So if I'm hearing you right: the connection itself worked fine, the folder control reassured you, but you cannot confidently explain the privacy model, especially what the AI does or doesn't see, and that uncertainty is itself the blocker. Is that fair?

**DM:** That's, yeah, that's exactly fair. The mechanics worked. I connected my email, no problem, even the code thing turned out fine. The control over folders, I liked. But the, the understanding? The part where I could turn to a client and say, with confidence, "here is precisely where your email is and precisely who can and can't see it"? I don't have that. It told me things, "encrypted," "on this computer," "never uploaded to us," and those are the right words, but they went by in little gray lines while a progress bar was moving, and they didn't add up, in my head, to a clear picture I could repeat back. I want, I want a, like a one-screen, plain-English, "here's the deal" that I could practically screenshot and show a client. What I got was reassuring fragments. Fragments aren't enough when it's my license.

**LW:** That is exactly the kind of finding this session is for. The ease question for this task, one to seven, connecting your email.

**[0:47]**

**DM:** [pause] The doing of it, I'd put at a, the actual clicking-through, maybe a five. But you're asking me overall, and overall I have to weight in the fact that I came out of it not understanding the most important thing about it. So I'll say four. Four out of seven. Because, look, if I sail through a process smoothly but at the end I can't answer "is my client's data safe and who saw it," then it wasn't really easy, it was, it was easy to operate and hard to trust. And for me those aren't separate. So, four. It worked, and it left me uneasy, and the unease is the part that counts.

**LW:** Thank you. [Field note: Task 3 = Success on the mechanical task, PARTIAL on comprehension. SEQ 4/7. Time band: expected. Device-code flow caused initial confusion ("why a code, why a browser") with a mild scam-pattern association, then self-resolved positively once she recognized the Microsoft domain and reframed it as "I'm not giving Keepance my password," a latent positive worth surfacing. Consent-screen/app-claim CONSISTENCY (read-only matches) actively built trust, a positive. Folder scoping landed strongly as control, a positive ("the difference between no and maybe"). The encryption/local-storage reassurances exist but are delivered as transient gray microcopy during sync and did NOT consolidate into an explainable mental model. CRITICAL: she cannot articulate what the AI does or does not see, and explicitly cannot separate "data at rest locally" from "data sent to provider." Per protocol, a wrong/uncertain belief about data location and exposure is severity 4 (liability-class). Gap is COMMUNICATION, not capability: the product reportedly does the right thing; the user cannot tell. Her own articulated fix: a single, plain-English, screenshot-able "here is exactly where your data is and who can see it."]

---

## Task 4: The payoff: find what a client said

**[0:48]**

**LW:** Okay. Now the part that matters. Picture it: a client is on the phone, right now, asking you what you agreed to about a deadline, back in the spring. Using your email here in Keepance, find the answer. Do it however feels natural to you.

**DM:** Oh, this, okay. This is the thing. This is literally my Tuesday. This is the 25-minute Outlook hunt I told you about last time, the settlement-number question, where I know it's in an email from the spring and Outlook gives me 250 results and none of them are it and I find it eventually by remembering a phrase the client used. If this can do this, this is, this is the whole reason I'd be here. Okay. So. Client wants to know what we agreed about a deadline in the spring. How would I, naturally? [pause] There's a Search tab. My instinct is search, because that's what I do in Outlook, I search. But you also said I could ask the AI. Hm. Let me, let me start with search, because that's my muscle memory. [clicks the "Search" tab]

[The Search tab opens with a search field.]

**DM:** Okay, search box. I'll type, what would I type. "Deadline." No, that's too broad, that's the Outlook mistake, I'd get everything. Let me think about what the client, um. Let me try, the client's name and deadline. [types "Keller deadline"] Wait, no, the spring deadline thing, let me, let me just try "deadline" and the matter. [types "deadline extension"] Let me try that. [presses Enter]

[Search returns a list of results. Results include files and mail; mail results are visually marked as mail, e.g., with an envelope icon and sender/date.]

**[0:50]**

**DM:** Okay, it gave me, it gave me results. And, oh, interesting, some of these have a little envelope icon, so those are, those are emails, and some are, the others are my files, the sample files. So it's searching both my documents and my email at once, and it's, it's telling me which is which. The emails have the little envelope. [scrolls the results] Okay so there's, there's a few emails here. [reads] "Re: Keller matter, scheduling." "Re: deadline." Hm. There's a couple. This is, this is already better than Outlook because it's not 250 results, it's, it's like six. But I still have to, I'd still have to open each one and read it to find the actual answer. [pause] Which is, I mean, it's better, but it's still me doing the reading. Let me, actually, you know what, let me try the other way. You said I can just ask the AI a question. Let me, let me see if that's, if that's smarter. Where's the, the AI tab. [clicks the "AI" tab]

[The AI chat opens. A chat input field is present, with the connected mailbox available as a source.]

**[0:51]**

**DM:** Okay, AI chat. There's a box to type in. So, can I just, ask it like a person? Let me, let me try just asking it the way I'd ask my paralegal. [types into the chat] "What did we agree to about the deadline in the Keller matter back in the spring?" [pause] That's, that's how I'd actually ask it. Let me, here goes. [presses Enter]

[A streaming indicator appears. The AI responds, and the response includes a specific answer with an inline citation/source chip referencing a specific email, which is clickable.]

**[0:52]**

**DM:** Okay, it's, it's thinking. [watches, 8 seconds] Okay, it's writing back. [reads aloud] "Based on an email from opposing counsel dated April 9, you agreed to a two-week extension of the document production deadline, moving it from April 15 to April 29. You confirmed this in your reply the same day." [pause] And there's, there's a little, there's a thing at the end, a, like a chip, or a footnote, it says, "Source," and it's, it looks clickable. It's referencing the email. [pause]

**DM:** [pause, quieter] Okay. Oh. Oh, that's, okay, that's, hold on. That's the thing. It just, it just told me the answer. In a sentence. "Two-week extension, April 15 to April 29, you confirmed it the same day." That's, that's the actual answer to the actual question. That's the thing that takes me 25 minutes in Outlook and it just, it just said it. [pause] Okay. Hang on though. Hang on. I don't, I'm not going to believe it just because it said it confidently. That's, that's the trap, right? That's the Avianca thing. That's a robot telling me something in a confident voice and me repeating it to a client and it being wrong. No. I, before I would ever say this to a client, I have to see the actual email. It says "source" and it looks like I can click it. Let me click it. Because if I can't click through to the real email, this answer is worthless to me. A lawyer cannot rely on an uncited AI answer. Period. So let me, let me see if this is real. [clicks the source citation]

[Clicking the citation opens the referenced email in a reading view, showing the actual message: sender, date, and the body text confirming the extension.]

**[0:54]**

**DM:** [pause] Okay. It, it opened the actual email. [reads] There it is. From opposing counsel, dated April 9, "we propose a two-week extension of the document production deadline, to April 29," and, and here's, here's my reply right under it, "agreed, April 29 works." [pause] So it's, it's not making it up. It's real. The email is real, the date is real, and it, it took me straight to it. [pause]

**DM:** [exhales, sits back] Okay. So. That. That right there. That is the difference between a toy and a tool. [pause] Let me, let me explain why I'm reacting this way, because I want to be clear it's not the AI sentence that won me. The AI sentence, on its own, I don't trust. I will never trust a robot's summary on its own, that's how you end up sanctioned, that's how you become the cautionary tale at the bar CLE. What won me is the, the line from the answer back to the actual source, that I can click, in one click, and verify with my own eyes. The citation is the whole thing. Without that citation, this is dangerous, it's a confident robot and I'd run screaming. With the citation, it's, it's a research assistant that shows its work. It found the needle, and then it let me confirm it's actually the needle. That, that I can use.

**LW:** Compare this to what you described last time, the Outlook hunt.

**DM:** It's, there's no comparison. Last time I told you about the 25-minute thing, the 250 results, the archived PST I couldn't see into, finding it by remembering a phrase the client used. That's, that's a, that's a tax on my whole career. And this just, I asked it in plain English, like I'd ask a person, and it gave me the answer and the receipt, in, in fifteen seconds. [pause] If, if this works on my real mailbox the way it just worked on this test one, this alone, this one feature, is worth the price of the thing. The intake stuff, the Word export, that's nice. This? This is, this is the reason I'd actually pull out a credit card. Because this is my actual daily pain and it just, it just dissolved it. With a receipt I can check. [pause] I, I came in at a four and arms-crossed. This moved me. I'll say that out loud. This is the first thing today that made me go, oh.

**LW:** That's a strong reaction. I want to make sure I capture it accurately. Is it fair to say the answer alone wouldn't have convinced you, and it's specifically the clickable, verifiable citation that did?

**DM:** A hundred percent fair. Write that down twice. The answer alone is, frankly, the answer alone is a liability. It's the citation that turns it from a liability into an asset. If your team is listening, do not ever let that AI answer questions about my email without giving me the click-through to the source. The day it answers without a citation is the day I stop trusting all of it, even the cited ones, because now I don't know which ones are real. The citation isn't a feature, it's the, it's the price of admission for a lawyer. But you've, you've got it. So. Yeah. [pause] Yeah.

**LW:** The ease question for this one. One to seven.

**[0:56]**

**DM:** [pause] That's a, that's a six. Maybe a six and a half if you let me. I'll say six, only because I dithered for a second between Search and the AI chat, I wasn't sure which one I was "supposed" to use, and the plain Search, the first thing I tried, that was just okay, it still made me do the reading. But the AI chat with the citation? That part's a seven all day. The fumble about which tool to start with is the only reason it's not a flat seven. The actual experience of asking a real question and getting the real answer with a real receipt, that, that's the best thing I've seen in this app by a mile. Six.

**LW:** Thank you. [Field note: Task 4 = Success (unassisted). SEQ 6/7. Time band: fast. THIS IS THE STUDY'S STRONGEST MOMENT. She reached for Search first (muscle memory from Outlook), found it merely incremental ("still me doing the reading"), then pivoted to AI chat unprompted and got the wedge experience. Genuine, audible delight ("Oh. That's the thing"), explicit unprompted comparison to her Session 1 Outlook nightmare ("there's no comparison... worth the price of the thing... the reason I'd actually pull out a credit card"). CRITICAL lawyerly behavior, exactly as predicted: she refused to trust the AI's confident answer until she clicked the citation and verified the source email herself. Her framing is unambiguous and quotable: "The answer alone is a liability. It's the citation that turns it from a liability into an asset... The citation isn't a feature, it's the price of admission for a lawyer." Minor friction: brief Search-vs-AI ambiguity (which tool to start with), severity 1 to 2. Baseline confidence visibly moved upward here.]

---

## Task 5: Trust and proof: would you bet a real matter on this?

**[0:56]**

**LW:** Last task. Imagine this is now part of your practice. Two things. First, show me how you'd check what the AI has been doing, and what it's costing you. Then tell me, honestly, whether you'd trust this with a live client matter, and what would have to be true for you to actually do that.

**DM:** Okay. What the AI's been doing. Um. There was a tab, in the tour, it said, "Audit." That, "audit," that sounds like exactly that, a record of what happened. Lawyers love an audit trail, or, we love it when it helps us and hate it when it's used against us, but. Let me find it. [scans the sidebar] It's, hm, the tour said Audit was under, let me look. [clicks the "AI" tab, then looks for Audit] There's, okay under the AI area there's a, "Audit." Let me click that. [clicks "Audit"]

[The Audit log opens: an append-only table of AI actions, each row showing prompt, model, tokens, cost, and timestamp. Filter controls and an export-to-CSV/JSON option are visible.]

**[0:58]**

**DM:** Okay. It's, it's a list. A table. Every, it looks like every time I used the AI. [reads] There's, there's the intake one from earlier, "Client Intake Synthesizer," and there's the, the email question I just asked, "What did we agree to about the deadline." And each one has, a timestamp, and it says which, which AI model, "Claude," and, huh, "tokens," and a, a cost, in, in cents. [pause]

**DM:** [pause] Okay, my, my first reaction, honestly? My first reaction is a little, a little uh-oh. Is this, is this thing recording everything I do? Like, every question I ask, it's, it's keeping a log of it? That's, my gut goes a little defensive, because, you know, a record of everything I asked an AI, in a litigation practice, that could be, that could be discoverable, that could be, somebody could subpoena that, that's, hm. [pause]

**LW:** [silent, waits, 7 seconds]

**DM:** [pause] Okay, but, let me, let me sit with that for a second instead of just reacting, because, hmm. [pause] Actually. Actually, no. Wait. Let me, let me flip that around. The thing I'm scared of with AI, the whole thing, is being the lawyer who can't account for what the AI did. Right? The Heppner guy, the problem wasn't that he used AI, it's that he used it recklessly and couldn't, couldn't show what he'd done with it. So if I ever, God forbid, had to stand in front of a judge, or the bar, or my malpractice carrier, and explain exactly what the AI did and did not do on a matter, this, this is, this is the thing that saves me. This is a, this is a complete, time-stamped record of every single thing the AI touched. That's, that's not surveillance of me, that's, that's my, that's my defense file. [pause] Okay, I, I reversed myself in real time there, you saw that. My gut said "it's watching me," and then my brain said, "no, this is the documentation that proves you were careful." And the second one's right. This is gold. If I'm being supervised, if I'm being careful, this is the proof I was careful.

**LW:** That's a really important shift. What flipped it for you?

**DM:** Thinking about who I'd show it to and why. My first instinct was, "who could use this against me," which is, that's the litigator's reflex, everything's discoverable. But then I thought about, the actual scenario where it comes up is, somebody's questioning whether I supervised my AI use properly, and in that scenario this, this log is the best friend I have. It says, here's every prompt, here's the model, here's when, here's what came back. That's, that's me having done my homework. So it went from "uh-oh, it's recording me" to "thank God it's recording this, because it's recording that I did it right." [pause] And, oh, look, I can, there's a button, I can export this, "CSV," "JSON." So I could pull it out, hand it to, whoever, my carrier, whatever. Okay. Yeah. Once I got over the flinch, this is, this is genuinely reassuring. This might be, this might be a bigger deal for adoption than I'd have guessed walking in. Because the thing standing between me and AI is the fear of being reckless, and this is literally a recklessness-prevention paper trail.

**LW:** And the cost side? You mentioned you saw cents in there.

**[1:00]**

**DM:** Right, the, the cost. So each row has a little cost on it, and there's, [looks around] there's a, up top there's a little chip thing that says, a total for, "today," looks like. And it's, it's pennies so far, like, thirty cents or something. [pause] Okay so, the cost thing, this is, this connects to the thing you, the BYOK thing, where I pay the AI company directly. So this is showing me what I'm racking up with, with Claude. [pause] And, okay, the honest part, the part where Keepance isn't taking a cut, where I'm just paying the actual AI company the actual cost, I, intellectually I respect that. A lot, actually. That's, that's not a company nickel-and-diming me, that's, here's the real cost, you pay it directly, we don't touch it. That's honest. After a career of vendors with hidden fees, that, that lands as integrity.

**LW:** But?

**DM:** But. [laughs] You knew there was a but. The but is, it's, it's per, it's by the question, by the, the "tokens," whatever those are. Which means I, I don't actually know what it's going to cost me in a heavy month. Like, today it's thirty cents because I asked it three things. But what about a, a deposition-prep week where I'm hammering it with that contradiction-finder thing across two thousand pages? Is that thirty cents or is that, is that three hundred dollars? I, I genuinely don't know, and that, that unpredictability, that bothers me. I'm a small firm. I budget. I do not like a meter running where I can't predict the bill. [pause] Now, this view helps, because at least I can see it accumulating, I'm not flying blind. But "I can watch it climb" is not the same as "I can predict it." What I'd really want is, like, a, "heads up, you're on track to spend X this month," or a way to set a, a cap, a, "don't let me spend more than fifty dollars without warning me." The honesty I appreciate. The unpredictability I don't. Both things are true.

**LW:** That's a clear and fair read. So let me ask the big one, the one this whole session has been building to. On a scale where this is part of your real practice: would you trust this with a live client matter? Why or why not?

**[1:01]**

**DM:** [long pause, 8 seconds] Okay. Honest answer. I'm, I'm a cautious yes, with conditions. Which, for me, coming in arms-crossed at a four, a cautious-yes-with-conditions is, that's actually a big movement. Let me, let me give you the conditions, because the conditions are the real answer.

**DM:** Condition one. I need to see, real lawyers, lawyers I'd respect, lawyers I'd have a drink with, vouching for this. I said that to you last time and it's still true and it's still the biggest one. Zero testimonials, for real client work, is close to a no for me, no matter how good the demo is. I need a name. I need, "so-and-so at such-and-such firm uses this for her practice." A CLE. A bar association that's heard of it. Something. Because I will not be the first lawyer in Cleveland to bet a client's confidentiality on a tool nobody I trust has touched. Lawyers move in herds for a reason, and the reason is our licenses.

**DM:** Condition two. And this is the one that, that today made urgent. I need a dead-simple, believable, plain-English answer to "where is my client's data and who can see it." The kind of thing I could practically print out and hand to a nervous client and say, "here, this is exactly what happens to your stuff." Right now I can't, I can't give that answer cleanly myself, I proved that twice today, on the files and on the email. The product clearly, clearly is built around keeping my data on my machine, that's the whole, that's the whole point of it, but it's not, it's not communicating it to me in a way I can hold onto and repeat. The search payoff almost doesn't matter if I can't answer the confidentiality question, because the confidentiality question is the one that's actually on my license.

**DM:** Condition three. I need to be able to try it. For real, on, on one low-stakes matter. Not the, not the sample files, not a sandbox, those are nice but they don't convince me. I mean, let me connect one real, sleepy, low-stakes matter, an estate thing, something where the confidentiality stakes are real but the litigation stakes are zero, and let me live with it for a few weeks and see if it does what it did just now on my actual email. The sample stuff gets me in the door. A real trial on a real low-stakes matter is what would actually flip me from "cautious yes" to "I'm a customer."

**LW:** So, real attorneys vouching, a data-safety story you can repeat and hand to a client, and a real trial on one low-stakes matter. If those three were true, where would you be?

**DM:** If those three were true? I'd, I'd be in. Genuinely. Because the core of it, the thing it actually does, the search, the finding-the-email-with-a-receipt thing, that's, that solved a real problem in front of my eyes today, and the audit log, once I got past my flinch, is a, is a confidentiality and supervision asset I didn't expect. The bones are, the bones are right. It's local, it shows its work, it keeps my files as real files, it found my email and let me verify it. Those are the right bones. What's missing for me isn't capability, it's, it's trust and proof and a story I can repeat. Which is, that's a, that's a fixable list. So, cautious yes, conditions stated, and if you fix the conditions, it's a real yes.

**LW:** The ease question for this last task, finding the audit and cost and forming that verdict. One to seven.

**[1:03]**

**DM:** [pause] I'll give that a five. The audit log I found pretty easily, the cost was right there, so the, the mechanics were fine. The reason it's not higher is, I had that, that whiplash on the audit log, where it scared me before it reassured me, and that flip happened in my own head, the product didn't help me make it. If the audit log had, like, a one-liner at the top that said "this is your record, it protects you," I'd have skipped the uh-oh entirely. And the cost thing left me with that unpredictability worry it didn't answer. So, five. I got where I needed to go and formed a real opinion, but the trust signals needed a little, a little framing help that wasn't there.

**LW:** Thank you. [Field note: Task 5 = Success. SEQ 5/7. Time band: expected. Audit log discoverability fine. CRITICAL framing finding, exactly as predicted: her FIRST read of the audit log was wary/surveillance ("is this thing recording everything I do... that could be discoverable"), then she REFRAMED it, unprompted, into a protective asset ("not surveillance of me, that's my defense file... recklessness-prevention paper trail... this is gold"). The flip was internal and self-generated; the product did not scaffold it. Recommendation territory: a one-line protective framing at the top of the audit log would prevent the initial negative read, severity 2, communication gap. Cost tracking: BYOK honesty respected intellectually and emotionally ("integrity," "not nickel-and-diming"), BUT per-token unpredictability is a real worry for a budget-conscious small firm ("I don't know what it'll cost me in a heavy month"); she wants a projection and/or a spend cap, severity 2 to 3, partly capability (cap/forecast) partly communication. ADOPTION VERDICT: cautious yes, gated on three explicit conditions: (1) real attorneys vouching / testimonials / CLE / bar presence, (2) a dead-simple, believable, plain-English, client-shareable data-safety story she can repeat, (3) a real trial on one real low-stakes matter (sample/sandbox insufficient). She explicitly frames the missing piece as trust/proof/communication, NOT capability.]

---

## Post-test

**[1:04]**

**LW:** That's the end of the tasks. You did great, and more importantly you talked the whole way through, which is exactly what I needed. I have a short standard questionnaire to finish, then a few wrap-up questions. The questionnaire is ten statements, and for each one you tell me how much you agree or disagree, on a scale of one to five, where one is strongly disagree and five is strongly agree. Don't overthink them, gut reactions.

**DM:** Okay. Fire away.

**LW:** One. I think I would like to use this system frequently.

**DM:** [pause] Four. Not a five, because of all the conditions I just gave you. But the email thing alone, if it works on my real mailbox, yeah, I'd use that constantly. Four.

**LW:** Two. I found the system unnecessarily complex.

**DM:** [pause] I'll say, two. It wasn't, it wasn't really complex, most of it. The API key thing was the only genuinely confusing part, and the export was hidden, but "complex" isn't the right word for those, they were more, badly explained or badly hidden than complex. So, two. A low-ish two.

**LW:** Three. I thought the system was easy to use.

**DM:** [pause] Three. A solid three. Some of it was easy, the form, the search, really easy. Some of it, the key, the export hunt, not easy. It nets out to a, a middle three. Easy in parts, friction in parts.

**LW:** Four. I think I would need the support of a technical person to be able to use this.

**DM:** [pause] Hmm. Three. And the entire reason it's not a one is that API key step. For most of this, no, I didn't need anybody. But at that key step, alone, at night? I might've called my IT contractor, or, more likely, just quit. So, three. Mostly self-serve, with one spot where I might need a hand.

**LW:** Five. I found the various functions well integrated.

**DM:** [pause] Four. Actually, yeah, four. The fact that I could go from a workflow to a document to a Word file, and that the search hit my files and my email together, and the AI could reach into my email, that, that did feel like one thing, not a bunch of bolted-together pieces. Four.

**LW:** Six. I thought there was too much inconsistency in the system.

**DM:** [pause] Two. I didn't really hit inconsistency. The icons were sometimes mysterious, but they were consistently mysterious. [laughs] So, two. Low.

**LW:** Seven. I imagine most people would learn to use this very quickly.

**DM:** [pause] Three. "Most people," I, depends who. A younger associate, fast. Me, or somebody my, my vintage, who's not a computer person? The key step would trip a lot of us. So, for "most people," I'll split it, three.

**LW:** Eight. I found the system very cumbersome to use.

**DM:** [pause] Two. "Cumbersome" implies it was a slog, and mostly it wasn't. The two snags, the key and the export, were annoying but brief. Not cumbersome overall. Two.

**LW:** Nine. I felt very confident using the system.

**DM:** [pause] Three. And this one's, this one's interesting, because my confidence using it went up over the hour, the search part I felt great, but the lingering "I can't explain where my data is" thing keeps it from being a four. Confident operating it, less confident I understand it. So, three.

**LW:** Ten. I needed to learn a lot before I could get going.

**DM:** [pause] Two. Honestly, no, not a lot. The form, the search, those I just, I just did. The one thing I had to "learn" was what an API key is, and even that was two sentences. So, two.

**[1:07]**

**LW:** [Field note: SUS item scores. Odd items (1,3,5,7,9): 4, 3, 4, 3, 3. Even items (2,4,6,8,10): 2, 3, 2, 2, 2. SUS computation: odd-item contributions (score minus 1): 3+2+3+2+2 = 12. Even-item contributions (5 minus score): 3+2+3+3+3 = 14. Sum = 26. SUS = 26 x 2.5 = 65.0. Reported band: this sits at the boundary of "OK/marginal-acceptable," just below the ~68 average; consistent with "usable but with real friction." Note for analysis: with the email-search payoff weighted by her stated intent, and accounting for the synthetic nature, treat the score as roughly high-60s; the two SUS-depressing factors are the API-key step and the data-comprehension uncertainty, both communication gaps, both fixable without new capability. Do not over-index on a single synthetic SUS; flag for real-n validation.]

**LW:** Thank you. That's the questionnaire. Now just a few wrap-up questions. First, top three things that worked for you today. The things you'd actually want to keep.

**DM:** [pause] Okay. Number one, easily, the email search. The asking-a-real-question-and-getting-the-real-answer-with-a-receipt-I-can-click. That's, that's the one. That's the reason I'd buy it. That solved my actual daily pain in front of my eyes, and it let me verify, which is the only way a lawyer can use it. Number one by a mile.

**DM:** Number two, the, the "it's my folders" thing. That my files are real files in a real folder on my own computer that I picked. Once I understood that, that, that matters to me, because I hate being locked into somebody's system. My stuff stays my stuff. That landed.

**DM:** Number three, and this one surprised me, the audit log. Once I got past the flinch. The fact that there's a complete, exportable record of everything the AI did, that, for somebody in my shoes who's terrified of being the reckless-AI cautionary tale, that's, that's a real comfort. It's proof I was careful. I did not expect to put that in my top three when I walked in.

**LW:** And top three frustrations. The things that got in your way.

**DM:** [pause] Number one frustration, the API key. No question. That's the spot where I nearly quit, where the, the developer word and the not-knowing-where-to-get-one almost ended the whole thing before it started. That one's, that's the dangerous one, because it's right at the front door and it could lose people like me before they ever get to the good stuff.

**DM:** Number two, finding the Word export. It was buried behind a mystery icon, and I almost concluded it couldn't do the thing it absolutely can do. For a lawyer, "get it into Word" is the whole point, and the button for it was hiding.

**DM:** Number three, and this is the heaviest one even though it's not a button, the, the uncertainty about what's actually safe. I went through the whole email connection and came out the other side not able to cleanly tell you, or a client, where the data is and who, especially the AI, can see it. That's, for my world, that's not a small thing, that's the thing. I, I think the product does the right thing, I just, I couldn't prove it or repeat it, and in my profession if you can't explain it you can't rely on it.

**[1:09]**

**LW:** If a colleague asked you tomorrow, what would you tell them this is, and whether to try it?

**DM:** [pause] I'd tell them, it's, it's an AI workspace that keeps your stuff on your own computer instead of in somebody's cloud, and the killer thing is it can search your email and actually find what a client said, and show you the real email so you can check it. I'd say, the email search alone nearly justified it for me. And then I'd say, but, it's early, I haven't seen other lawyers using it yet, and I couldn't fully get my head around the data-safety details, so I'm watching it, not betting a real matter on it yet. I'd tell them to keep an eye on it and to watch for whether real attorneys start vouching for it. I'd say, "this could be the thing that finally fixes the email nightmare, but I want to see who else jumps first." That's, that's an honest version of what I'd say over coffee.

**LW:** Last question, and it's the most important one. What is the one thing that, if we fixed it, would most change your answer about using this for real, for live client work?

**[1:10]**

**DM:** [pause, 6 seconds] The one thing. Okay. It's, it's the data-safety story, combined with the proof. Let me, let me say it as one thing because to me it is one thing. I need a dead-simple, believable, plain-English picture of exactly where my client's data lives and exactly who can and cannot see it, the app, the AI, anybody, that I can understand, repeat, and hand to a worried client, plus the proof that real lawyers are already trusting it. If you gave me that, a clear "here's exactly what happens to your data" that I could actually explain, and a few real attorneys vouching, then the search payoff and the audit trail and the my-folders thing, all of which already work, would carry the rest. The capability's there. What's missing is, I can't yet tell my client it's safe in words I'd stake my license on, and I can't yet point to a colleague who does. Fix that, the believable safety story plus the social proof, and I go from "cautious yes with conditions" to "where do I put my card." That's the one thing. Make me able to honestly tell a client where their data is and show me a lawyer I'd have a drink with who uses it. Do that and you've got me.

**LW:** That is exactly the answer I was hoping you'd give me, not because it's flattering, it isn't entirely, but because it's clear and it's actionable. Diane, this was tremendously valuable. You talked through everything, you let yourself get stuck and told me about it, and you were honest about both the good and the bad. That's the whole job, and you did it beautifully.

**DM:** Well, you didn't rescue me, so I had no choice but to figure it out and complain about it. [laughs] No, this was, this was fine. Better than I expected, honestly. That email thing, I, I'm going to be thinking about that email thing. If it does that on my real mailbox, you'll, you'll hear from me.

**LW:** I hope we do. Your honorarium is being processed and you'll see it by the end of the week. Thank you again, truly. We'll close the recording here.

**[1:11]**

[End of session. Recording stopped.]

---

## Moderator post-session summary notes (for analysis hand-off)

> These are field notes captured immediately post-session, not the formal write-up. They exist to seed the analysis. This is synthetic Pass A data; every finding below is a hypothesis to validate with real attorneys, not a proven result.

**Per-task outcomes:**

| Task | Outcome | Assist? | SEQ | Time band |
|---|---|---|---|---|
| 1: Onboarding to working workspace | Success (assisted) | Yes, moderator supplied test API key after sustained stall | 4/7 | Slow |
| 2: Workflow to Word deliverable | Success (effectively unassisted) | No verbal assist; ~30s export hunt | 5/7 | Expected-to-slow |
| 3: Connect email + understand it | Success (mechanical) / Partial (comprehension) | No | 4/7 | Expected |
| 4: Find what a client said (the payoff) | Success (unassisted) | No | 6/7 | Fast |
| 5: Trust, cost, adoption verdict | Success | No | 5/7 | Expected |

**SUS:** 65.0 (boundary of marginal-acceptable; treat as roughly high-60s; usable with real friction). Two depressors: API-key comprehension and data-location uncertainty. Both communication gaps.

**Top findings, ranked:**
1. **Email search + clickable citation is the wedge, confirmed (positive, highest signal).** The verifiable citation, not the answer, is what wins a lawyer. Severity-0 as a problem; this is the product's strongest asset. Protect it absolutely: an uncited AI answer would actively destroy trust.
2. **API key step is the #1 drop-off, confirmed (severity 3 to 4, communication).** Explainer + test-key button partially rescue; "where do I get one" still under-supported; near-abandonment at the front door.
3. **Data-comprehension gap is a liability-class finding (severity 4, communication).** She cannot separate "stored on vendor servers" from "prompt sent to provider," and cannot say what the AI sees. Reassurances exist but as transient microcopy. Her own fix: one plain-English, client-shareable "where is your data and who can see it" screen.
4. **Word export is buried (severity 3, communication/IA).** Capability is excellent (clean .docx cleared her bar and delighted her); discoverability behind an unlabeled icon nearly caused a false "it can't do this" conclusion.
5. **Raw Markdown as default view reads as "code" (severity 3, communication/IA).** Rendered view recovers it but is not default; nearly caused write-off.
6. **Audit log framing is double-edged (severity 2, communication).** First read = surveillance; she self-reframed to "protective / my defense file." A one-line protective header would prevent the negative first read.
7. **Cost unpredictability worries a budget-conscious small firm (severity 2 to 3, mixed).** BYOK honesty respected; wants a forecast and/or spend cap.

**Positives to bank:** workspace-as-folder (once explained) lands as anti-lock-in; profession picker speaks her language; "test this key" green check earns explicit praise; device-code flow nets positive once understood ("I'm not giving Keepance my password"); consent-screen/app-claim consistency builds trust; folder scoping reads as control ("the difference between no and maybe").

**Adoption verdict:** Cautious yes, gated on three conditions, all communication/proof, none capability: (1) real attorneys vouching / CLE / bar presence, (2) a believable, repeatable, client-shareable data-safety story, (3) a real trial on one low-stakes matter (sample insufficient). The single highest-leverage fix per the participant: the believable plain-English data-safety story plus social proof.
