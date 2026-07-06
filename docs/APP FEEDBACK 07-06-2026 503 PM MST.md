APP FEEDBACK 07/06/2026 5:03 PM MST

- Overall, I want to remove a lot of text throughout the app that isn't high impact and isn't very valuable. First, we can remove, click a row to focus AI on that client. We can then remove "View" next to the Clients/Wholebook toggle. Next, for the client list, the Ask button, Documents button, and Email button should go to the right of the name. There's no reason to put them under the name. And the Archive button should go to the right of the Created column so that each row is just one line, nice and compact, but with some white space margin above and below. Also, each client row needs the other buttons: meetings, and activity to the right of the email button. Also, we don't need the Documents column. There's no reason to sort by the amount of documents. And instead of Archive being its own button, we should have three dots at the right of each row that gives more options for each client, including Archive and any other options that would make sense on the screen as shortcuts for the user. And the Clients and Whole Book toggle should really go directly to the right of the New Client button and it should be sized the same so it has the same height so it looks cohesive with the New Client button. 
- For the sources pane on the right, that should be auto-collapsed. Users should be able to expand and collapse it from a smaller state. 
- Also, I really like the look of the screen for an individual client where we have the tabs that say client map, document, email, meetings, activity at the top. And I want this general styling with these light lines and this tab style to be the same on the clients list so that new client is one of those is up in the area where those other tabs are and looks like those tabs but is a button. And then the clients and whole book toggle is up there as well horizontally in line with the client's title just like the individual client view. Basically the clients list needs to have lighter lines and match the style of the ask tab and the individual client view and the workflows.
- I changed my mind and I want to remove all subtext under the headers for the different tabs. So they all should look like workflows in the individual client view, which means that the clients list should get rid of the text that says three clients, three folders indexed, click a row to focus AI on that client. Let's remove that whole subtext. And I'm not sure why the client's icon is a black suitcase when all the other icons are red. That black suitcase needs to be red. And I don't like the suitcase. That needs to be an icon of people. Similarly, we need to get rid of the subtext on the Ask tab under Ask that says "Your Private Practice Assistant. Answers from your files are cited. General Help is clearly marked." We need to remove that whole line. 
- One big issue I just found is that if you click on a source in the client map, it doesn't switch over to the documents tab and then open that file underneath the row of buttons, such as new document, new folder. Instead, it takes you to a completely different documents screen with no easy way to go back. We need to fix that. 
- Another thing is when I edit an item in the client map, it does allow me to change that bullet, but it doesn't change the source at the bottom or it doesn't add anything to show that I edited it and what I edited. We need to include that in a history of edits so that a financial advisor knows exactly who changed what and when. 
- Another thing is when I added a section to the client map, a custom section, it looks like it worked well, but when I clicked remove there was no confirmation modal. We definitely need a confirmation modal to prevent accidental deletion. And then it's unclear when these sections are synced or updated. Ideally, there would be a sync button at the very top row next to the name of the client. Just a sync icon, the circle arrows, that re-scans data or documents and updates. The client map. We need that AND evidence in the same area of when it was last updated.
- Also in the Documents tab of a specific client, when I open a document it gets rid of all the buttons like New Tab, etc. which feels jarring, we need to keep those around. 
- Another bug I just found that we need to change, if you click a client in the left-hand column in the expandable clients list, and then you click client map, that should go straight to that client's client map. It shouldn't go to the list of clients again. 
- I successfully connected my Outlook and it says it imported 44 emails but for the three practice families it says no emails found. I think we should have some demo emails that reference these practice families so that they load and I can search them
- I'm confused what the badge is that says the client name and that says only on each client map at the top right. This doesn't make sense to me because I'm not sure how you could select multiple in this view. I think we need to remove this badge altogether. Basically the expandable clients list in the left hand side should replace the purpose of this badge so that the user always knows what clients they are searching on with what client is selected at the left and is displayed at the top above the logo. 
- In the whole book toggle on the clients list, the progress bars in the client map column are red because that's the current branding, but these need to be a nice progress green regardless of the branding because right now it looks like these are errors because it's red. 
- At the top of the client list in the left pane, the expandable one, we need a little search bar at the very top to easily search through clients because advisors could have even up to like a hundred or more clients. And this would be a really easy way to search through them. And this is what I've decided I want to do. For the client map tab on the left, the first time you click it, if you don't have a client selected, it would just be a blank screen with some small text that says "Click a client on the left." And then once a client is clicked on the left, it brings up that individual client with their tabs. And now that a client is selected, every time you click the client map, it just shows their client map for that client. So instead of having a separate clients list in the main window and you click "Client Map" tab, it would just say "Click a client to get started." And once you click one, it would show their client map. 
- In the client map there needs to be an option to add bullets to any of the sections, whether they are the pre-made sections or custom sections. And for removing bullets there needs to be a confirmation dialog. We also need the ability to export the client map. We need an export button or a share button that creates a nice PDF or Word document, nicely designed with the Advisor Prep Hero branding. 
- Another thing is that I tried to record a Teams meeting and it worked pretty well. It got the audio and the transcript. But it said that the card was not able to enter the meeting and these were the logs I noticed in the console around that time:
	
[notice-card] notice-card-2 
{kind: 'pre-admit-giveup', reason: 'join-timeout', willRetry: true}
kind
: 
"pre-admit-giveup"
reason
: 
"join-timeout"
willRetry
: 
true
[[Prototype]]
: 
Object
constructor
: 
ƒ Object()
hasOwnProperty
: 
ƒ hasOwnProperty()
isPrototypeOf
: 
ƒ isPrototypeOf()
propertyIsEnumerable
: 
ƒ propertyIsEnumerable()
toLocaleString
: 
ƒ toLocaleString()
toString
: 
ƒ toString()
valueOf
: 
ƒ valueOf()
__defineGetter__
: 
ƒ __defineGetter__()
__defineSetter__
: 
ƒ __defineSetter__()
__lookupGetter__
: 
ƒ __lookupGetter__()
__lookupSetter__
: 
ƒ __lookupSetter__()
__proto__
: 
(...)
get __proto__
: 
ƒ __proto__()
set __proto__
: 
ƒ __proto__()
noticeCardLifecycle.ts:51 [notice-card] notice-card-2 
{kind: 'attempt', attempt: 2, reason: 'pre-admit-retry'}
attempt
: 
2
kind
: 
"attempt"
reason
: 
"pre-admit-retry"
[[Prototype]]
: 
Object
constructor
: 
ƒ Object()
hasOwnProperty
: 
ƒ hasOwnProperty()
isPrototypeOf
: 
ƒ isPrototypeOf()
propertyIsEnumerable
: 
ƒ propertyIsEnumerable()
toLocaleString
: 
ƒ toLocaleString()
toString
: 
ƒ toString()
valueOf
: 
ƒ valueOf()
__defineGetter__
: 
ƒ __defineGetter__()
__defineSetter__
: 
ƒ __defineSetter__()
__lookupGetter__
: 
ƒ __lookupGetter__()
__lookupSetter__
: 
ƒ __lookupSetter__()
__proto__
: 
(...)
get __proto__
: 
ƒ __proto__()
set __proto__
: 
ƒ __proto__()
noticeCardLifecycle.ts:51 [notice-card] notice-card-2 
{kind: 'terminal', reason: 'internal'}
kind
: 
"terminal"
reason
: 
"internal"
[[Prototype]]
: 
Object
constructor
: 
ƒ Object()
hasOwnProperty
: 
ƒ hasOwnProperty()
isPrototypeOf
: 
ƒ isPrototypeOf()
propertyIsEnumerable
: 
ƒ propertyIsEnumerable()
toLocaleString
: 
ƒ toLocaleString()
toString
: 
ƒ toString()
valueOf
: 
ƒ valueOf()
__defineGetter__
: 
ƒ __defineGetter__()
__defineSetter__
: 
ƒ __defineSetter__()
__lookupGetter__
: 
ƒ __lookupGetter__()
__lookupSetter__
: 
ƒ __lookupSetter__()
__proto__
: 
(...)
get __proto__
: 
ƒ __proto__()
set __proto__
: 
ƒ __proto__()

- We absolutely need to get this right and get the card entering each meeting successfully and ideally a nice recorded voice that says "this meeting is being recorded" So everyone absolutely knows that it's being recorded. And then if the recording is stopped in the app, then the card will then speak out. The card will change and a new voice will say "Recording stopped". This input and feedback is crucial, so we need to figure out how to do this successfully. 
- One problem I see with the meetings tab is that it's very messy. We need to clean it up. Let's have a few sub-tabs in meetings. One of them being "Recording" Where the advisor can view the audio and listen to it and any notes about what happened, like if no one spoke, etc. plus the ability to download the audio. Another transcript that shows the transcript (and ability to export/copy). Another is summary which is a nice summary of the meeting for the advisor to review / export to word/pdf / copy out. I don't think we need to show a live Docx version of the notes. I think it'll be fine to export which would switch to a tab in Documents that's a Docx that they can then export. Also it looks like right now you can't rename the meeting and we definitely need to be able to do that. And then on the activity tab, at the bottom for Maria and Luis Alvarez, I see it says "Active Matter" - We definitely can't have active matter or the word matter showing up anywhere (Unless it's legitimately used in a sentence) Because that is a vestige of our old target audience attorneys. So we need to say something else for clients of financial advisors. 
- I like how in the top right it says using cloud AI, but right now that's not clickable. Instead, we need to make that clickable to be able to switch to local AI or no AI, basically to bring up the AI options. 
- I just noticed also that in the top right there's three icons an eye a map and a lock Right now the map and the lock say the same thing the map just brings it up as a modal and The lock brings it up as a screen we need to Choose one To go with please recommend what you think is best. 
- In the Ask tab, I'm confused the difference between the All Clients filter and the Whole Practice filter. If there's no meaningful difference, then we need to just remove Whole Practice. 
- In the Ask tab, on some of the example questions and on a new question, I click Save to Document in the main conversation window and nothing happens.
- Right now when you click a source in the ask tab it takes you to that full documents page again that's really hard to know where you are in the app instead that needs to go to that specific clients documents tab to open that document. And we also need a back button and the back button is really helpful because as you Jump around different places in the app. You'll be able to go back to where you previously were For example, if you click a source in the ask tab and it bounces you to the documents tab of that client map Then the back button will take you back to that ask conversation.
-  On the Ask tab, we really need to move the Files Only mode toggle and the container that allows file access. Those are taking up a huge amount of space in the main window. They need to be hidden in a menu or something. Please recommend what you think would be best. 
- For the sources pane as well on the right, we don't need to show such a huge preview. We can just show a few lines and make it expandable. But default to just showing a few lines so that that pane can show more sources easily and the intended behavior is to click on them to see the full document. 
- On the Ask tab, we definitely need a small search bar at the top of the conversations below new question to search the Conversation titles to bring up a conversation.
- For the workflow tab, I just tried to run one of them and it asked me if I wanted to run it for the current client I selected. We don't need that confirmation. Instead, we just need to go right to the questions. But one problem I found in the questions is that it doesn't autofill the client name. We need that to happen. So the advisor knows what family they're making it for. 
- Also within a workflow, I clicked continue, but I hadn't filled out one of the sections. And instead of automatically scrolling back up to that section, it did nothing, so I had no idea what was going on. We need to auto-scroll up to the section you didn't fill out. And also that button should not be continue, it should say run Because that's what it does. And then one problem was after I clicked continue it took me back to view all of the Workflows and it said running in the area that usually says run But the problem is when I clicked running It started a new one or tried to start a new workflow, which doesn't make any sense Running should Not be clickable and it should show an animated icon The icon was not animated. And then when it was done, it popped up in a new section called Recent Runs and showed a green checkmark that said an advisor's annual review packet had been created. But when I click that, nothing happens. And when I go to their documents, I don't see anything. We need a really clear trail and we need a better title instead of advisor's annual review packet. It should include the client's name and show what type of document it is, PDF or DocX. One of those. And it needs to be well designed. And automatically saved in a Workflows folder in the client's documents.
