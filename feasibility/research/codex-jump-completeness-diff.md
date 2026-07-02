# Codex Jump Completeness Diff

Baseline read: `feasibility/jump-feature-inventory.md`, `docs/plans/lantern-plus/2026-07-02-JUMP-COVERAGE-AUDIT.md`, and `feasibility/research/claude-census-diff-context.md`.

Coverage checked: Jump help center sitemap (175 URLs: 168 articles plus 7 collections), all public product/operating-system links visible in Jump navigation, `/integrations`, `/pricing`, `/enterprise`, `/press`, `/press-releases`, and March-June 2026 product/press posts. The sibling list caught most major gaps; below are additions or narrower depths I found that are not explicitly captured there.

## Additional Missing Features / Depths

### 1. Private meetings with calendar privacy mirroring

Status: shipped
Source URL: https://help.jumpapp.com/en/articles/13418754-how-private-meetings-work-in-jump

Jump can mirror Google/Microsoft private calendar events into Jump so sensitive meetings can still be captured without automatically exposing title, notes, transcripts, AI outputs, or recap/prep links to team admins. Invited users keep normal access, while non-invited team admins see only a non-clickable Busy placeholder; account owners can enable or disable this behavior from compliance settings.

### 2. Account-level notetaker timing controls

Status: shipped
Source URL: https://help.jumpapp.com/en/articles/11832214-how-to-control-when-the-notetaker-enters-your-meetings

Account owners can set when the Jump notetaker joins virtual meetings, including up to 30 minutes before or 60 minutes after the scheduled start. They can also control how long the notetaker waits in an empty meeting or waiting room before leaving, with platform defaults available for Zoom, Google Meet, and Microsoft Teams.

### 3. Zoom in-client notetaker controls

Status: shipped
Source URL: https://help.jumpapp.com/en/articles/11032094-how-to-send-the-notetaker-right-from-my-zoom-meeting

Jump has a Zoom in-client app that lets users add, pause, or remove the Jump notetaker from inside the live Zoom window. This is different from generic Zoom capture because the advisor can manage the recorder without switching back to Jump.

### 4. Consent monitoring modes

Status: shipped
Source URL: https://help.jumpapp.com/en/articles/10064437-how-to-manage-meeting-capture-consent

Jump's compliance settings support four capture-consent modes: automatic verbal-consent detection, advisor self-attestation before note access, both together, or off. The automatic mode analyzes the transcript and records whether the advisor-client exchange included consent.

### 5. AI Associate action scope beyond CRM record creation

Status: beta
Source URL: https://jump.ai/press/jump-launches-ai-associate-an-intelligent

The existing inventory says AI Associate can create CRM records, but Jump describes a broader action layer: create and update records, assign follow-up tasks, draft and send client communications, and schedule meetings or follow-ups from one conversation. Jump says every action is governed by firm compliance settings and requires human confirmation.

### 6. Pre-meeting prep visuals and presentation export

Status: shipped
Source URL: https://jump.ai/products/meet/pre-meeting-prep

Jump's prep briefs can include portfolio charts, net worth history, asset allocation breakdowns, and other visual data. Jump positions those outputs as exportable into client-facing presentations, not only advisor-only prep text.

### 7. Meeting-note PDF export preview and formatting controls

Status: shipped
Source URL: https://jump.ai/blog/new-releases-april-2026

Jump added a real-time PDF preview before downloading meeting notes. Users can adjust font size, choose which sections to include, and resize the preview before saving the final PDF.

### 8. Scorecard and Flash Survey analysis reports

Status: shipped
Source URL: https://jump.ai/blog/june-product-update

Jump added AI-generated Analysis Reports for Scorecards and Flash Surveys, matching the existing Pulse report workflow. These reports summarize survey/scorecard data, interpret trends, identify next steps, and export as PDFs.

### 9. Holistiplan Scenario Analysis in prep

Status: shipped
Source URL: https://jump.ai/blog/june-product-update

The existing inventory captures Holistiplan as a tax integration, but Jump's June update adds Scenario Analysis as a selectable pre-meeting prep source. That means tax scenario-modeling context can appear directly in the generated prep brief, not just static tax-return fields.

### 10. HubSpot Deals and Tickets as meeting action items

Status: shipped
Source URL: https://jump.ai/blog/updates-may-2026

Jump's HubSpot integration can create Deals and Tickets directly from meeting action items, not only tasks or notes. This matters because post-meeting work can become pipeline or support objects without leaving Jump.

### 11. Redtail embedded AI Associate and deeper prep fields

Status: shipped
Source URL: https://jump.ai/blog/updates-may-2026

Jump embedded AI Associate directly in Redtail's AI Notetaker tab, so Redtail users can use the assistant without opening Jump first. Jump also expanded Redtail pre-meeting prep to include note/activity comments and User Defined Fields from Redtail Contacts and Accounts.

### 12. SharePoint meeting-note PDF destination

Status: shipped
Source URL: https://help.jumpapp.com/en/articles/13417352-sharepoint-integration

The sibling list caught Google Drive and Box, but Jump also has a SharePoint integration for saving meeting notes as PDFs directly into firm folders. This is a document-management destination, not just a CRM or planning-system sync.

### 13. Smart meeting detection and attendee prefill for capture quality

Status: shipped
Source URL: https://jump.ai/blog/june-product-update

Jump now checks whether a calendar event is scheduled within seven minutes when a user starts "Capture a meeting now" and offers to attach the capture to the existing event. The same June update adds attendee selection before in-person web recording, improving speaker-label accuracy because Jump knows who is in the room before recording starts.

### 14. Meeting page as a modular work surface

Status: shipped
Source URL: https://jump.ai/blog/meeting-page-updates

Jump rebuilt the meeting page so notes, tasks, transcript, sync controls, scorecards, forms, signals, and other outputs live as first-class tabs instead of buried side-panel modules. This is a product-depth point: Jump's meeting record is becoming the operational hub for every output tied to that conversation, not just a note page.

### 15. Conversation search as a named Meet capability

Status: shipped
Source URL: https://jump.ai/products/meet

Jump lists Conversation Search as part of Meet: search meetings, notes, transcripts, and client interactions to find context instantly. This overlaps with AI Associate, but Jump markets it as a direct search capability inside the meeting product, not only as ask-anything chat.

## Refutations

- No sibling-list claim was disproven. The sibling claim that MCP and API/build access contradict the older "no public API" weakness is directionally correct: Jump's pricing page lists MCP under "Features included in all plans" and "API & build access" under Enterprise. Source: https://jump.ai/pricing
- One wording caveat: public evidence supports Enterprise "API & build access" and MCP availability, but I did not find public developer documentation, endpoint docs, or a self-serve public API portal. Treat the old "no public API" weakness as unsafe, but do not assume a developer-friendly public API is fully documented.
