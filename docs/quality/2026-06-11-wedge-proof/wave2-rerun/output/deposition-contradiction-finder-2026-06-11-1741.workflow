{
  "schemaVersion": 1,
  "runId": "run_1781199670924_6lavix9",
  "template": {
    "id": "legal-deposition-contradiction-finder",
    "name": "Deposition Contradiction Finder",
    "description": "Flag candidate contradictions between a witness's deposition testimony and the rest of the matter record (other documents, emails, prior statements). Grounded in matter-scoped retrieval; every finding carries a citation you verify. Produces a structured Word deliverable.",
    "version": "2.0.0",
    "category": "legal",
    "requiresVerification": true,
    "verificationNote": "Verify every flagged contradiction against the original transcript before use. AI can misread nuance, context, or page breaks.",
    "steps": [
      {
        "id": "interview",
        "type": "interview",
        "name": "Deposition Details",
        "description": "Provide the transcript excerpts and the key claims you want scrutinized",
        "config": {
          "questions": [
            {
              "id": "matterName",
              "question": "Matter name",
              "description": "The case or matter name as you track it in your files.",
              "type": "text",
              "required": true,
              "placeholder": "e.g., Smith v. Acme Corp."
            },
            {
              "id": "witnessName",
              "question": "Witness name",
              "description": "Full name of the deponent whose transcript you are analyzing.",
              "type": "text",
              "required": true,
              "placeholder": "e.g., Jane Doe"
            },
            {
              "id": "depositionDate",
              "question": "Deposition date",
              "description": "Date the deposition was taken. Used for citation purposes in the output.",
              "type": "text",
              "required": true,
              "placeholder": "e.g., May 15, 2026"
            },
            {
              "id": "keyClaimsToScrutinize",
              "question": "Key claims to scrutinize",
              "description": "The specific factual assertions or storyline elements you want to test for consistency. Be specific — the more targeted this list, the more useful the output.",
              "type": "textarea",
              "required": true,
              "placeholder": "e.g., Witness claims she never received the email. Witness claims the meeting on March 3 never happened. Witness claims she had no supervisory role over the plaintiff."
            },
            {
              "id": "depositionExcerpts",
              "question": "Deposition transcript excerpts",
              "description": "Paste the relevant portions of the deposition transcript. Include page and line numbers (e.g., \"P. 42:3-18\") for each excerpt — the analysis will reference them. You can paste multiple excerpts; separate them with a blank line.",
              "type": "textarea",
              "required": true,
              "placeholder": "P. 42:3-18\nQ: Did you receive the email?\nA: No, I never received anything from him.\n\nP. 87:9-21\nQ: How often did you communicate with the plaintiff?\nA: Rarely. Maybe once or twice a quarter."
            },
            {
              "id": "priorStatements",
              "question": "Prior statements to compare against (optional)",
              "description": "Paste excerpts from earlier sworn statements, affidavits, interrogatory answers, or prior deposition testimony. If none, leave blank. Including these allows the analysis to flag contradictions between this deposition and earlier statements.",
              "type": "textarea",
              "required": false,
              "placeholder": "e.g., Affidavit dated January 10, 2026: \"I received the email from Mr. Johnson and forwarded it to my supervisor immediately.\""
            }
          ]
        }
      },
      {
        "id": "analyze-contradictions",
        "type": "analyze",
        "name": "Flag Contradictions (cited)",
        "description": "Retrieve the matter record, flag candidate contradictions, verify each citation, and produce a Word deliverable",
        "config": {
          "analyzeKind": "contradictions",
          "outputFile": "Deposition Contradiction Analysis.docx",
          "retrievalQueryTemplate": "Testimony and statements by {{witnessName}} relevant to: {{keyClaimsToScrutinize}}. Deposition excerpts: {{depositionExcerpts}}. Prior statements: {{priorStatements}}",
          "topK": 12,
          "perSourceCap": 4,
          "pastedInputIds": [
            "depositionExcerpts",
            "priorStatements"
          ],
          "promptTemplate": "You are a tireless first-year associate assisting a licensed attorney. You FLAG candidate contradictions for the attorney to verify. You do not render judgments and you never provide legal advice. Your job is to organize the record so the attorney can exercise their own judgment.\n\nMatter: {{matterName}}\nWitness: {{witnessName}}\nDeposition date: {{depositionDate}}\n\nKey claims the attorney wants scrutinized:\n{{keyClaimsToScrutinize}}\n\nDeposition transcript excerpts the attorney pasted:\n{{depositionExcerpts}}\n\nPrior statements the attorney pasted to compare against:\n{{priorStatements}}\n\nBelow is additional context retrieved from THIS MATTER's documents and emails. Each source is numbered [N]. When you quote a statement, cite the source NUMBER it came from.\n\n{{retrievedContext}}\n\nIdentify candidate contradictions between the witness's testimony and other statements (elsewhere in the testimony, in prior statements, or in the retrieved matter sources). For EACH candidate contradiction return a finding with:\n  - statementA: the first statement, with the exact quote and the source NUMBER [N] it came from.\n  - statementB: the conflicting statement, with the exact quote and the source NUMBER [N] it came from.\n  - conflictRationale: a plain-language explanation of why they conflict.\n  - topic: a short heading grouping the finding.\n  - followUpQuestions: optional follow-up deposition questions.\n\nRules:\n  - Only cite statements that actually appear in the material above. If a quote is not in any numbered source, set its sourceNumber to 0. Never fabricate a citation.\n  - Do NOT invent contradictions. If the record does not support a conflict, do not report one. An empty findings list is a valid, honest answer.\n  - Quote exactly; do not paraphrase inside the quote field.",
          "documentTitle": "Deposition Contradiction Analysis: {{witnessName}}",
          "verificationBanner": "Each finding below was flagged by an AI associate and carries a citation. Verify every quote and page/line reference against the original transcript and source before relying on it.",
          "systemPrompt": "You are a methodical, citation-focused legal research assistant helping a licensed attorney organize and analyze deposition testimony. You never provide legal advice and always frame your output as a starting point for the attorney's review. You do not speculate beyond what the record supports, and you never fabricate a citation. If the record is ambiguous, you note the ambiguity rather than resolve it."
        }
      }
    ],
    "requiredInputs": [],
    "outputs": [
      "Deposition Contradiction Analysis.docx"
    ],
    "namedOutputs": [
      {
        "id": "contradictions",
        "name": "Contradiction findings",
        "schema": "array"
      },
      {
        "id": "followup_questions",
        "name": "Suggested follow-up questions",
        "schema": "array"
      }
    ]
  },
  "workflowFolderPath": "/tmp/wedge-ws/Deposition Contradiction Finder - 2026-06-11_17-41-10",
  "currentStepIndex": 1,
  "status": "completed",
  "inputs": {
    "interview_answers": {
      "matterName": "Johnson v. Nexus Dynamics Corp.",
      "witnessName": "Marcus Johnson",
      "depositionDate": "May 28, 2026",
      "keyClaimsToScrutinize": "Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. The deadline he was given for his written response to the compliance review. How many weeks of severance he was offered.",
      "depositionExcerpts": "Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.",
      "priorStatements": ""
    },
    "matterName": "Johnson v. Nexus Dynamics Corp.",
    "witnessName": "Marcus Johnson",
    "depositionDate": "May 28, 2026",
    "keyClaimsToScrutinize": "Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. The deadline he was given for his written response to the compliance review. How many weeks of severance he was offered.",
    "depositionExcerpts": "Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.",
    "priorStatements": "",
    "analyze-contradictions_findings": [
      {
        "topic": "Document Forwarding",
        "statementA": {
          "locator": "incident-summary-johnson.md paragraph 1",
          "quote": "Johnson reports billing irregularities to ethics hotline and HR",
          "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "textMismatch"
        },
        "statementB": {
          "locator": "incident-summary-johnson.md paragraph 2",
          "quote": "Document forwarding to personal email (IT policy compliance)",
          "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "verified"
        },
        "conflictRationale": "Statement A refers to a report made to the ethics hotline, while statement B implies that this was done improperly by forwarding documents to his personal email.",
        "verified": false,
        "followUpQuestions": [
          "Was it your intention to report irregularities to HR or did you mean to send an email?",
          "Can you describe how you understood the company's IT policy regarding document preservation?"
        ]
      },
      {
        "topic": "Termination Cause",
        "statementA": {
          "locator": "incident-summary-johnson.md paragraph 1",
          "quote": "Johnson reports billing irregularities to ethics hotline and HR",
          "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "textMismatch"
        },
        "statementB": {
          "locator": "incident-summary-johnson.md paragraph 2",
          "quote": "Document forwarding to personal email (IT policy compliance)",
          "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "verified"
        },
        "conflictRationale": "Statement A suggests that the report of irregularities was a motivating factor in Johnson's termination. Statement B implies a different reason for his termination, namely IT policy noncompliance.",
        "verified": false,
        "followUpQuestions": [
          "Do you believe your termination was related to reporting billing irregularities or to a document preservation issue?",
          "Can you explain how these two incidents are connected?"
        ]
      },
      {
        "topic": "Served Written Response Deadline",
        "statementA": {
          "locator": "incident-summary-johnson.md paragraph 1",
          "quote": "Oct 10, 2025 | Deadline for Johnson's written response (per this summary)",
          "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "textMismatch"
        },
        "statementB": {
          "locator": "deposition-transcript-johnson.txt paragraph 5",
          "quote": "Meeting with Weston and Liu regarding Q2 expense discrepancies",
          "citationId": "b1d16415a92b37220f6682d9e6e61c518aa964391c734ed3916261eb42ee6caa",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/deposition-transcript-johnson.txt",
          "verdict": "textMismatch"
        },
        "conflictRationale": "The timeline suggests that the meeting occurred after the deadline stated in statement A.",
        "verified": false,
        "followUpQuestions": [
          "Can you clarify whether there was a specific date set for Johnson's written response?",
          "Was there any discussion about a deadline during the meeting?"
        ]
      },
      {
        "topic": "Severance Offer",
        "statementA": {
          "locator": "incident-summary-johnson.md paragraph 2",
          "quote": "the offer as eight weeks",
          "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "verified"
        },
        "statementB": {
          "locator": "incident-summary-johnson.md paragraph 0",
          "quote": "stating he was offered four weeks of severance",
          "citationId": "a9f827c74a6917fb0e97763b4b7e29a61c069aecf10428157c9d137c3f6fca7d",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "textMismatch"
        },
        "conflictRationale": "Statement A and statement B conflict regarding the length of time mentioned in Johnson's severance package.",
        "verified": false,
        "followUpQuestions": [
          "Can you describe your understanding of the severance offer?",
          "Do you believe there was a misunderstanding about the terms of the offer?"
        ]
      },
      {
        "topic": "Termination Date",
        "statementA": {
          "locator": "incident-summary-johnson.md paragraph 1",
          "quote": "Johnson hired as Product Manager",
          "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
          "verdict": "textMismatch"
        },
        "statementB": {
          "locator": "huge-notes.md paragraph 5",
          "quote": "the November 2025 termination — may be insufficient on its own.",
          "citationId": "92080f75e42ababf980bb5c012d340f4ba25a850769976c8aacd17f63e01db07",
          "matterId": "unassigned",
          "sourceId": "/tmp/wedge-ws/huge-notes.md",
          "verdict": "verified"
        },
        "conflictRationale": "The timeline provided suggests that Johnson was terminated in November 2025. However, statement A indicates he started working for the company in February 2020.",
        "verified": false,
        "followUpQuestions": [
          "Can you clarify whether your employment ended in February or November?",
          "Do you believe there is any connection between these dates?"
        ]
      }
    ],
    "analyze-contradictions_summary": {
      "total": 5,
      "verified": 0,
      "unverified": 5
    },
    "analyze-contradictions_file": "Deposition Contradiction Analysis.docx",
    "analyze-contradictions_scope": {
      "kind": "allMatters"
    }
  },
  "stepOutputs": [
    {
      "interview_answers": {
        "matterName": "Johnson v. Nexus Dynamics Corp.",
        "witnessName": "Marcus Johnson",
        "depositionDate": "May 28, 2026",
        "keyClaimsToScrutinize": "Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. The deadline he was given for his written response to the compliance review. How many weeks of severance he was offered.",
        "depositionExcerpts": "Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.",
        "priorStatements": ""
      },
      "matterName": "Johnson v. Nexus Dynamics Corp.",
      "witnessName": "Marcus Johnson",
      "depositionDate": "May 28, 2026",
      "keyClaimsToScrutinize": "Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. The deadline he was given for his written response to the compliance review. How many weeks of severance he was offered.",
      "depositionExcerpts": "Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.",
      "priorStatements": ""
    },
    {
      "analyze-contradictions_findings": [
        {
          "topic": "Document Forwarding",
          "statementA": {
            "locator": "incident-summary-johnson.md paragraph 1",
            "quote": "Johnson reports billing irregularities to ethics hotline and HR",
            "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "textMismatch"
          },
          "statementB": {
            "locator": "incident-summary-johnson.md paragraph 2",
            "quote": "Document forwarding to personal email (IT policy compliance)",
            "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "verified"
          },
          "conflictRationale": "Statement A refers to a report made to the ethics hotline, while statement B implies that this was done improperly by forwarding documents to his personal email.",
          "verified": false,
          "followUpQuestions": [
            "Was it your intention to report irregularities to HR or did you mean to send an email?",
            "Can you describe how you understood the company's IT policy regarding document preservation?"
          ]
        },
        {
          "topic": "Termination Cause",
          "statementA": {
            "locator": "incident-summary-johnson.md paragraph 1",
            "quote": "Johnson reports billing irregularities to ethics hotline and HR",
            "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "textMismatch"
          },
          "statementB": {
            "locator": "incident-summary-johnson.md paragraph 2",
            "quote": "Document forwarding to personal email (IT policy compliance)",
            "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "verified"
          },
          "conflictRationale": "Statement A suggests that the report of irregularities was a motivating factor in Johnson's termination. Statement B implies a different reason for his termination, namely IT policy noncompliance.",
          "verified": false,
          "followUpQuestions": [
            "Do you believe your termination was related to reporting billing irregularities or to a document preservation issue?",
            "Can you explain how these two incidents are connected?"
          ]
        },
        {
          "topic": "Served Written Response Deadline",
          "statementA": {
            "locator": "incident-summary-johnson.md paragraph 1",
            "quote": "Oct 10, 2025 | Deadline for Johnson's written response (per this summary)",
            "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "textMismatch"
          },
          "statementB": {
            "locator": "deposition-transcript-johnson.txt paragraph 5",
            "quote": "Meeting with Weston and Liu regarding Q2 expense discrepancies",
            "citationId": "b1d16415a92b37220f6682d9e6e61c518aa964391c734ed3916261eb42ee6caa",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/deposition-transcript-johnson.txt",
            "verdict": "textMismatch"
          },
          "conflictRationale": "The timeline suggests that the meeting occurred after the deadline stated in statement A.",
          "verified": false,
          "followUpQuestions": [
            "Can you clarify whether there was a specific date set for Johnson's written response?",
            "Was there any discussion about a deadline during the meeting?"
          ]
        },
        {
          "topic": "Severance Offer",
          "statementA": {
            "locator": "incident-summary-johnson.md paragraph 2",
            "quote": "the offer as eight weeks",
            "citationId": "8a695d2f81a84aa8751ea0556fb063e8ab99af1e4bf966c1180f4a7bf675e031",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "verified"
          },
          "statementB": {
            "locator": "incident-summary-johnson.md paragraph 0",
            "quote": "stating he was offered four weeks of severance",
            "citationId": "a9f827c74a6917fb0e97763b4b7e29a61c069aecf10428157c9d137c3f6fca7d",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "textMismatch"
          },
          "conflictRationale": "Statement A and statement B conflict regarding the length of time mentioned in Johnson's severance package.",
          "verified": false,
          "followUpQuestions": [
            "Can you describe your understanding of the severance offer?",
            "Do you believe there was a misunderstanding about the terms of the offer?"
          ]
        },
        {
          "topic": "Termination Date",
          "statementA": {
            "locator": "incident-summary-johnson.md paragraph 1",
            "quote": "Johnson hired as Product Manager",
            "citationId": "def2c0cc3ca1d1173817c3bc2d69a67e2272d62058acfe4d8d2bfee3f3333ae4",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/incident-summary-johnson.md",
            "verdict": "textMismatch"
          },
          "statementB": {
            "locator": "huge-notes.md paragraph 5",
            "quote": "the November 2025 termination — may be insufficient on its own.",
            "citationId": "92080f75e42ababf980bb5c012d340f4ba25a850769976c8aacd17f63e01db07",
            "matterId": "unassigned",
            "sourceId": "/tmp/wedge-ws/huge-notes.md",
            "verdict": "verified"
          },
          "conflictRationale": "The timeline provided suggests that Johnson was terminated in November 2025. However, statement A indicates he started working for the company in February 2020.",
          "verified": false,
          "followUpQuestions": [
            "Can you clarify whether your employment ended in February or November?",
            "Do you believe there is any connection between these dates?"
          ]
        }
      ],
      "analyze-contradictions_summary": {
        "total": 5,
        "verified": 0,
        "unverified": 5
      },
      "analyze-contradictions_file": "Deposition Contradiction Analysis.docx",
      "analyze-contradictions_scope": {
        "kind": "allMatters"
      }
    }
  ],
  "completedAnswers": [
    {
      "stepName": "Deposition Details",
      "answers": {
        "matterName": "Johnson v. Nexus Dynamics Corp.",
        "witnessName": "Marcus Johnson",
        "depositionDate": "May 28, 2026",
        "keyClaimsToScrutinize": "Whether Johnson forwarded documents to his personal email or all materials stayed on company servers. The deadline he was given for his written response to the compliance review. How many weeks of severance he was offered.",
        "depositionExcerpts": "Q. Did you preserve those documents? A. I believe I did. I forwarded them to my personal email for safekeeping. Q. Did Mr. Weston tell you a deadline for submitting the explanation? A. He said I had until October 17, 2025 to submit my written response. Q. At the time of your termination, did anyone at Nexus Dynamics explain the severance package being offered? A. Sandra Liu gave me a document describing a four-week severance.",
        "priorStatements": ""
      }
    }
  ],
  "startTime": "2026-06-11T17:41:10.924Z",
  "artifacts": [
    "Deposition Contradiction Analysis.docx"
  ],
  "endTime": "2026-06-11T17:44:36.112Z"
}