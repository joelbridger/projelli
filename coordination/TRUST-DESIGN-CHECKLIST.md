# Trust Design Checklist — every feature brief MUST answer this (from the 2026-07-05 assessment)

Advisor Prep Hero's entire differentiator is trust. Trust must be a DESIGN INPUT for every feature, not a review that catches overclaiming late. Any build brief touching a user-facing surface answers these BEFORE building:

1. **What does this feature CLAIM (in copy, labels, pills, tooltips), and is every claim literally true against the code?** (The Data Map "never writes back" falsehood happened because copy and behavior were written separately. Verify each claim against the actual code path.)
2. **What does the OTHER person in the room experience?** (The client in the meeting, the colleague reading the CRM note, the recipient of an AI-drafted email, the compliance officer with the exported report.) Does it surprise, embarrass, or misrepresent the advisor?
3. **What would a compliance officer ask, and can we answer with EVIDENCE not assertion?** ("Prove my client's data never left"; "show me what the AI read.")
4. **Does any AI output travel OUTWARD (email, CRM, shared note) carrying provenance, or does it read as the advisor's own un-sourced words?**
5. **At WHAT MOMENT does this fire in the advisor's real day, and what competes for their attention then?** (The consent dialog lands at the most loaded second — right before a client meeting.)
6. **What does this feature deliberately NOT prove / NOT do — and does the UI say so honestly rather than overclaiming?**

If any answer is "it overclaims" or "the other person is surprised," fix the design before building. This is enforced at brief-review time by the coordinator.
