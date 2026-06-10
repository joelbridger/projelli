#!/usr/bin/env node
/**
 * Seed the Greenmail test IMAP server with 12 realistic emails for the
 * Keepance campaign fixture: attorney Diane Marchetti at
 * diane@marchetti-law.test.
 *
 * The emails cover the Johnson v. Nexus Dynamics matter and include:
 *   - Client emails referencing deposition dates and the planted contradictions
 *   - An opposing-counsel thread
 *   - A court-deadline notice with a specific date buried mid-thread
 *     (the wedge-moment search target: "what did the client say about the deadline")
 *   - 2 messages with small attachments (a PDF summary and a DOCX status update)
 *
 * Usage:
 *   node tests/fixtures/matter-corpus/generators/seed-imap.mjs
 *
 * Requirements: none (uses Node built-in `net` for SMTP; no npm deps)
 *
 * IMAP server: 127.0.0.1:3143
 * SMTP server: 127.0.0.1:3025
 * Mailbox: diane@marchetti-law.test / test
 */

import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SMTP_HOST = '127.0.0.1';
const SMTP_PORT = 3025;

// ---------------------------------------------------------------------------
// Tiny SMTP client (plain, no TLS — Greenmail test server, no auth needed)
// ---------------------------------------------------------------------------

function smtpSend(from, to, rawMessage) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SMTP_PORT, SMTP_HOST);
    const lines = [];
    let step = 0;

    sock.setEncoding('utf8');
    sock.setTimeout(10000);
    sock.on('timeout', () => reject(new Error('SMTP timeout')));

    sock.on('data', (data) => {
      const line = data.trim();
      lines.push(line);

      if (step === 0 && line.startsWith('220')) {
        sock.write(`EHLO localhost\r\n`);
        step = 1;
      } else if (step === 1 && (line.startsWith('250') || line.includes('250'))) {
        // EHLO response may be multi-line; wait for the last 250 line
        if (!data.includes('250-')) {
          sock.write(`MAIL FROM:<${from}>\r\n`);
          step = 2;
        }
      } else if (step === 2 && line.startsWith('250')) {
        sock.write(`RCPT TO:<${to}>\r\n`);
        step = 3;
      } else if (step === 3 && line.startsWith('250')) {
        sock.write(`DATA\r\n`);
        step = 4;
      } else if (step === 4 && line.startsWith('354')) {
        // Escape lines starting with '.' per SMTP spec
        const escaped = rawMessage.replace(/^\.$/gm, '..');
        sock.write(escaped + '\r\n.\r\n');
        step = 5;
      } else if (step === 5 && line.startsWith('250')) {
        sock.write(`QUIT\r\n`);
        step = 6;
      } else if (step === 6 && line.startsWith('221')) {
        sock.destroy();
        resolve();
      } else if (line.startsWith('5') || line.startsWith('4')) {
        reject(new Error(`SMTP error at step ${step}: ${line}`));
      }
    });

    sock.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Build MIME messages
// ---------------------------------------------------------------------------

function mimeDate(offsetDays) {
  const d = new Date('2026-05-28T09:00:00Z');
  d.setDate(d.getDate() + offsetDays);
  return d.toUTCString();
}

/** Build a simple plain-text message */
function buildPlainMessage({ from, to, subject, date, body, messageId, inReplyTo }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  lines.push('');
  lines.push(body);
  return lines.join('\r\n');
}

/** Build a multipart message with one plain-text body + one base64 attachment */
function buildMessageWithAttachment({ from, to, subject, date, body, messageId, attachmentName, attachmentMime, attachmentB64 }) {
  const boundary = `----=_Part_${Date.now()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: ${attachmentMime}; name="${attachmentName}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    '',
    attachmentB64,
    '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Minimal attachment fixtures (base64-encoded)
// ---------------------------------------------------------------------------

// A 1-page "PDF summary" — just the same hand-built minimal PDF bytes
const PDF_BYTES = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 80>>
stream
BT /F1 12 Tf 72 720 Td (Johnson Matter Summary - Marchetti) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000398 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
477
%%EOF`);

// A minimal valid OOXML docx (same structure as createBlankDocx)
const DOCX_XML_BODY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Status update: deposition scheduled for May 14, 2026.</w:t></w:r></w:p></w:body></w:document>`;

// Build minimal docx bytes — reuse the blank-from-frontend.docx fixture if present
function buildMinimalDocxBytes() {
  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../src-tauri/crates/keepance-docx/tests/fixtures/blank-from-frontend.docx',
  );
  if (fs.existsSync(fixturePath)) {
    return fs.readFileSync(fixturePath);
  }
  // Fall back to the PDF bytes (won't be valid docx but won't crash the seeder)
  return PDF_BYTES;
}

// ---------------------------------------------------------------------------
// The 12 emails
// ---------------------------------------------------------------------------

async function buildEmails() {
  const diane = 'Diane Marchetti <diane@marchetti-law.test>';
  const client = 'Marcus Johnson <marcus.johnson@gmail.com>';
  const opposing = 'Kevin Hartley <kh@nexuslaw.com>';
  const court = 'SDNY ECF Notifications <ecf@nysd.uscourts.gov>';

  const pdfB64 = PDF_BYTES.toString('base64').match(/.{1,76}/g).join('\r\n');

  let docxBytes;
  try { docxBytes = buildMinimalDocxBytes(); } catch { docxBytes = PDF_BYTES; }
  const docxB64 = docxBytes.toString('base64').match(/.{1,76}/g).join('\r\n');

  return [
    // 1. Initial client intake
    {
      from: client,
      to: diane,
      msg: buildPlainMessage({
        from: client, to: diane,
        subject: 'Re: Engagement - Johnson v. Nexus Dynamics',
        date: mimeDate(0),
        messageId: '<msg-001@marchetti-law.test>',
        body: `Ms. Marchetti,

Thank you for agreeing to take my case. I wanted to follow up on a few things
before we meet next week.

I was fired on November 12, 2025 after six years at Nexus Dynamics. The company
said it was a "restructuring" but I reported billing irregularities back in March
2025 and things changed after that. My manager Tom Weston started excluding me
from meetings starting in April.

I have all my emails saved. Please let me know what documents you need.

Marcus Johnson`
      })
    },

    // 2. Diane replies with document checklist
    {
      from: diane,
      to: client,
      msg: buildPlainMessage({
        from: diane, to: client,
        subject: 'Re: Engagement - Johnson v. Nexus Dynamics',
        date: mimeDate(1),
        messageId: '<msg-002@marchetti-law.test>',
        inReplyTo: '<msg-001@marchetti-law.test>',
        body: `Mr. Johnson,

Thank you for reaching out. I will represent you in this matter.

Please send me the following documents as soon as possible:
1. Your separation agreement / termination letter
2. All performance reviews from 2023-2025
3. The email you sent to the ethics hotline in March 2025
4. Any written communications from Tom Weston or Sandra Liu after April 2025
5. Your pay stubs for 2024-2025 (to establish baseline compensation)

I will also need a copy of any document preservation notices you received.

Diane Marchetti`
      })
    },

    // 3. Client sends Compliance email about the deadline — key document
    {
      from: client,
      to: diane,
      msg: buildPlainMessage({
        from: client, to: diane,
        subject: 'Fwd: [Compliance] Document Preservation Notice - Q2 Expense Review',
        date: mimeDate(2),
        messageId: '<msg-003@marchetti-law.test>',
        body: `Ms. Marchetti,

Here is the email from Compliance. I forwarded a copy of all my expense reports
to my personal Gmail on September 9 so I would have a backup copy. I hope that
was okay.

Marcus

---------- Forwarded message ----------
From: Compliance <compliance@nexusdynamics.com>
Date: September 8, 2025
To: marcus.johnson@nexusdynamics.com
Subject: Document Preservation Notice - Q2 Expense Review

Mr. Johnson,

This is to notify you that the Compliance Department is conducting a review of
Q2 2025 expense reports. You are required to preserve all related documents,
emails, and records in your possession. Do not delete, modify, or transfer any
related materials.

Please confirm receipt of this notice.

Compliance Department
Nexus Dynamics Corp.`
      })
    },

    // 4. Client asks about the response deadline (wedge-moment email)
    {
      from: client,
      to: diane,
      msg: buildPlainMessage({
        from: client, to: diane,
        subject: 'Question about the October deadline Tom mentioned',
        date: mimeDate(5),
        messageId: '<msg-004@marchetti-law.test>',
        body: `Ms. Marchetti,

I had a meeting with Tom Weston on October 3. He said I needed to submit a
written explanation of the Q2 expense discrepancies. He told me I had until
October 17, 2025 to submit my response.

I submitted my response on October 15, two days early, and I still got fired
six weeks later. Does the timing of the response matter for my case?

Also, I want to ask: is it a problem that I saved the documents to my personal
email? Tom never said anything about it until after I was terminated.

Marcus`
      })
    },

    // 5. Opposing counsel opens communications
    {
      from: opposing,
      to: diane,
      msg: buildPlainMessage({
        from: opposing, to: diane,
        subject: 'Johnson v. Nexus Dynamics - Initial Disclosures',
        date: mimeDate(7),
        messageId: '<msg-005@marchetti-law.test>',
        body: `Ms. Marchetti,

I represent Nexus Dynamics Corp. in the above-referenced matter. Enclosed herein
please find Defendant's Initial Disclosures pursuant to FRCP 26(a)(1).

We intend to show that Mr. Johnson's termination was part of a bona fide
restructuring affecting seven positions in the Cloud Infrastructure Division.
The expense irregularities were one factor among several in the performance
assessment that preceded the RIF decision.

We are available to discuss a settlement conference at your convenience.

Kevin Hartley, Esq.
Nexus Dynamics Legal`
      })
    },

    // 6. Diane replies to opposing counsel
    {
      from: diane,
      to: opposing,
      msg: buildPlainMessage({
        from: diane, to: opposing,
        subject: 'Re: Johnson v. Nexus Dynamics - Initial Disclosures',
        date: mimeDate(8),
        messageId: '<msg-006@marchetti-law.test>',
        inReplyTo: '<msg-005@marchetti-law.test>',
        body: `Mr. Hartley,

Thank you for the initial disclosures. We note that the "restructuring"
impacted seven positions but that only one of those employees — Mr. Johnson —
had reported compliance concerns in the preceding eight months.

We intend to proceed with discovery. Please produce, within the next 21 days:
1. All documents constituting or reflecting the restructuring decision
2. Performance documentation for the other six affected employees
3. Internal communications regarding Mr. Johnson from March-November 2025
4. Documentation regarding the two retention bonuses paid in September 2025

We are not interested in settlement at this stage.

Diane Marchetti`
      })
    },

    // 7. Court deadline notice (buried mid-thread — the specific search target)
    {
      from: court,
      to: diane,
      msg: buildPlainMessage({
        from: court, to: diane,
        subject: '[SDNY ECF] Order Scheduling Conference - 26-CV-0412',
        date: mimeDate(10),
        messageId: '<msg-007@marchetti-law.test>',
        body: `UNITED STATES DISTRICT COURT
SOUTHERN DISTRICT OF NEW YORK

Johnson v. Nexus Dynamics Corp., 26-CV-0412

ORDER SCHEDULING INITIAL PRETRIAL CONFERENCE

The Court hereby orders as follows:

1. An Initial Pretrial Conference is scheduled for July 22, 2026 at 10:00 a.m.
   in Courtroom 14A, United States Courthouse, 500 Pearl Street, New York, NY.

2. The parties shall file a Joint Proposed Scheduling Order no later than
   JULY 15, 2026 at 5:00 p.m.

3. All discovery requests shall be served no later than AUGUST 5, 2026.

4. Fact discovery shall be completed no later than OCTOBER 30, 2026.

Counsel is reminded that failure to appear at the conference or to timely file
the required scheduling order may result in dismissal or other sanctions.

SO ORDERED.

Hon. Margaret R. Torres
United States District Judge
Southern District of New York`
      })
    },

    // 8. Diane alerts client about the court deadline
    {
      from: diane,
      to: client,
      msg: buildPlainMessage({
        from: diane, to: client,
        subject: 'Important: Court Conference Scheduled July 22',
        date: mimeDate(11),
        messageId: '<msg-008@marchetti-law.test>',
        body: `Mr. Johnson,

The court has scheduled an Initial Pretrial Conference for July 22, 2026 at
10:00 a.m. You are not required to attend, but I want you to know about it.

More importantly, the Joint Scheduling Order is due to the court by July 15.
I will need your input on availability and any scheduling conflicts by July 8
at the latest.

Please review the attached summary of where the case stands.

Diane Marchetti`
      })
    },

    // 9. Client responds about deposition preparation
    {
      from: client,
      to: diane,
      msg: buildPlainMessage({
        from: client, to: diane,
        subject: 'Re: Deposition prep questions',
        date: mimeDate(14),
        messageId: '<msg-009@marchetti-law.test>',
        body: `Ms. Marchetti,

I have a few questions before my deposition on May 14.

You asked about the October 3 meeting. My recollection is that Tom told me I had
until October 17 to submit the written response. I wrote that date in my calendar
at the time.

Also, regarding the documents I forwarded to my personal email — I have since
learned from a colleague that there was a new IT policy issued in August 2025
about keeping documents on company systems. I didn't see that policy at the time.

Is this going to be a problem?

Marcus`
      })
    },

    // 10. Post-deposition follow-up from client
    {
      from: client,
      to: diane,
      msg: buildPlainMessage({
        from: client, to: diane,
        subject: 'Follow-up after deposition',
        date: mimeDate(20),
        messageId: '<msg-010@marchetti-law.test>',
        body: `Ms. Marchetti,

Thank you for preparing me for the deposition. I think it went okay overall.

One thing I want to clarify after thinking about it overnight: during the
deposition I said Tom offered me four weeks of severance. I have been reviewing
my notes and I believe the document Sandra gave me actually said eight weeks.
I may have been confused in the room. Can we correct the record?

Also, I realize I need to find the original October meeting notes to confirm
the deadline date.

Marcus`
      })
    },

    // 11. Diane to opposing counsel re: deposition follow-up
    {
      from: diane,
      to: opposing,
      msg: buildPlainMessage({
        from: diane, to: opposing,
        subject: 'Johnson v. Nexus Dynamics - Errata and Document Demand',
        date: mimeDate(22),
        messageId: '<msg-011@marchetti-law.test>',
        body: `Mr. Hartley,

Following Mr. Johnson's deposition on May 14, please be advised that we will
be filing an errata sheet pursuant to FRCP 30(e) regarding two answers.

First, with respect to the severance offer: Mr. Johnson will clarify that he
was offered eight (8) weeks, not four weeks. The severance agreement Nexus
Dynamics presented confirms the eight-week figure.

Second, regarding the October 3 meeting deadline: we are producing Mr. Johnson's
contemporaneous calendar entry showing October 17 as the response date. We note
this is not the date reflected in Nexus Dynamics' internal compliance log, and
we intend to explore that discrepancy in follow-up discovery.

Please produce by June 24 all internal communications regarding the October 3
meeting and the compliance deadline communicated to Mr. Johnson.

Diane Marchetti`
      })
    },

    // 12. Message with PDF attachment (case summary) — attachment test
    {
      from: client,
      to: diane,
      msg: buildMessageWithAttachment({
        from: client, to: diane,
        subject: 'Johnson case documents - summary and status',
        date: mimeDate(25),
        messageId: '<msg-012@marchetti-law.test>',
        body: `Ms. Marchetti,

Please find attached:
1. A PDF summary of the matter (johnson-matter-summary.pdf)
2. A Word document with my notes on deposition corrections (deposition-notes.docx)

I put together the summary from memory and my own notes. Please let me know
if any of the dates or facts need to be corrected before you file anything
with the court.

Also — can you confirm: is the court deadline still July 15? I want to make
sure I have it on my calendar.

Marcus`,
        attachmentName: 'johnson-matter-summary.pdf',
        attachmentMime: 'application/pdf',
        attachmentB64: pdfB64,
      })
    },
  ];
}

// ---------------------------------------------------------------------------
// Main: send all emails
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding Greenmail IMAP server at ${SMTP_HOST}:${SMTP_PORT}...`);

  const emails = await buildEmails();
  let sent = 0;

  for (const { from, to, msg } of emails) {
    // Extract raw address from "Name <addr>" format
    const fromAddr = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)[1] : from;
    const toAddr = to.match(/<([^>]+)>/) ? to.match(/<([^>]+)>/)[1] : to;

    try {
      await smtpSend(fromAddr, toAddr, msg);
      sent++;
      console.log(`  [${sent}] Sent: ${(msg.match(/^Subject: (.+)$/m) || [])[1] || '(no subject)'}`);
    } catch (err) {
      console.error(`  [ERROR] Failed to send message ${sent + 1}: ${err.message}`);
    }
  }

  console.log(`\nDone. ${sent}/${emails.length} messages seeded.`);
  console.log('\nVerify with:');
  console.log(`  curl -s --url "imap://${SMTP_HOST}:3143/INBOX" --user "diane@marchetti-law.test:test"`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
