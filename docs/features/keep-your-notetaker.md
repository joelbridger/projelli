# Keep your notetaker. We read its notes.

Advisor Prep Hero is not a meeting notetaker, and you do not have to give
yours up. If you use Jump or Zocks today, keep using it. Advisor Prep Hero
reads the notes your notetaker produces, files them with the right client,
and folds them into that client's Client Map, cited answers, and prep briefs.

When a Jump note lands anywhere Advisor Prep Hero already watches, it is
recognized automatically. You will see a "Jump meeting note" tag on the
note's chips in the Client Map, and you can filter any section down to
"Imported meeting notes" to see exactly which facts came from your
notetaker. Zocks notes arrive through the built-in Zocks connection and get
the same treatment.

There are three ways to route notes in. Pick the one that matches how your
tools are already set up. You only need one.

## Recipe 1: Jump notes through your CRM (Wealthbox)

Best if Jump already syncs its notes into your Wealthbox.

1. In Jump, turn on the Wealthbox integration so finished meeting notes are
   saved to the client's record in Wealthbox. This is a Jump setting, not an
   Advisor Prep Hero one.
   <!-- VERIFY-LIVE: confirm the exact Jump settings path/name for the
        Wealthbox notes sync against a live Jump account before publishing. -->
2. In Advisor Prep Hero, connect Wealthbox: Settings, Connections, Wealthbox.
   You paste your Wealthbox API token once. It is stored in your computer's
   secure keychain.
3. Match your Wealthbox households to your clients when prompted. This is a
   one-time step.
4. Done. Each time Jump finishes a note and syncs it to Wealthbox, the next
   Advisor Prep Hero sync brings it in, files it under the right client, and
   tags it as a Jump meeting note.

## Recipe 2: Jump note exports through a watched OneDrive or SharePoint folder

Best if you save or export Jump notes as files, or your firm keeps meeting
recaps in a shared drive.

1. Create a folder in OneDrive or SharePoint for meeting notes, for example
   "Meeting Notes" inside each client's folder.
2. In Advisor Prep Hero, connect OneDrive/SharePoint: Settings, Connections,
   OneDrive. Sign in with your Microsoft account.
3. Map the folder (or each client subfolder) to the right client when asked.
4. Save your Jump note exports into that folder. Keep Jump's own file name,
   which usually contains the word Jump and the meeting date. Advisor Prep
   Hero recognizes those files as Jump meeting notes and dates them from the
   file name.

## Recipe 3: The Zapier fallback

Best if your firm already runs Zapier and you want zero manual saving.

1. In Zapier, create a Zap with the trigger "note finalized" from Jump.
   <!-- VERIFY-LIVE: confirm the exact Jump Zapier trigger name before
        publishing. -->
2. Add a OneDrive action: "Create file" in the watched folder from Recipe 2.
   Use the note text as the file contents, and include the word "Jump" and
   the meeting date in the file name, for example
   "Jump Meeting Recap 2026-06-24 - Brennan.txt".
3. That is all. Every finalized Jump note now lands in the folder Advisor
   Prep Hero already watches, and gets recognized and filed like any other
   Jump export.

## What happens to imported notes

- They are filed under the matched client and appear with a provenance tag,
  so you always know a fact came from your notetaker rather than from a
  source document.
- They join the client's cited recall. Ask a question and answers can cite
  the meeting note, with a link back to it.
- They stay on your machine. Importing a note never sends its content to
  Advisor Prep Hero's servers, because there are none to send it to.

## Notes and limits

- Recognition is automatic for Jump exports by file name or by the note's
  own branding and structure. A renamed file without Jump branding in the
  text imports fine but shows as a regular document.
- Zocks notes come in through the dedicated Zocks connection and are tagged
  as Zocks meeting notes.
- Email is never treated as a notetaker export. Forwarding a note by email
  imports the email, not a tagged meeting note. Use one of the three recipes
  above instead.
