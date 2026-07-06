# UI Simplification pass — screenshots for Jameson

Branch: `lp/ui-simplification` @ `b2bbc6ac`, built and run live on the cloud Windows
bench (`lantern-cloud-bench-1`), light theme, real app (not a mock). Taken 2026-07-06.
Purpose: let Jameson eyeball the de-cluttered look before this branch merges.

| # | File | What to notice |
|---|---|---|
| 00 | `00-before-ai-privacy-maintip.jpeg` | **BEFORE.** The AI & Privacy settings card on the current live app (main branch), from an earlier QA pass (2026-07-04). Every card has a full paragraph of gray explanatory text sitting right there under it — "AI runs on your machine…", "Your own API key talks directly…", etc. Busy. |
| 03 | `03-after-ai-privacy.jpeg` | **AFTER — pairs with 00.** Same screen on this branch. The gray paragraphs are gone; a small "i" icon sits next to each title instead ("Where AI requests go", "On this computer only", "Cloud AI", "Network lockdown"). Nothing is lost — it's one hover away — but the screen at rest is much calmer. |
| 04 | `04-ai-privacy-hover-tooltip.png` | Proof the hidden text still works: hovering the "i" next to "Cloud AI (your account)" pops a real tooltip with the same explanation that used to sit in gray text permanently. |
| 01 | `01-clientlist-expanded.jpeg` | The left client list, expanded. Client rows no longer repeat the client's name a second time in gray underneath — just the name once, cleanly. |
| 02 | `02-clientlist-collapsed.jpeg` | The same client list, collapsed with one click (new — didn't exist before). Useful when you want more room for the middle Clients table and don't need the sidebar list right now. |
| 06 | `06-onboarding-choosestart.jpeg` | First real onboarding screen ("How do you want to start?"). Explanatory text again moved behind "i" icons next to the heading and each of the two option cards. |
| 05 | `05-onboarding-ai.jpeg` | Onboarding step 2, "Connect your AI" — pick a provider and paste a key. Not part of this sweep (no gray-text cleanup needed here), included so you can see the whole flow in order. |
| 07 | `07-onboarding-connect.jpeg` | Onboarding step 3, "Securely connect your data" — Microsoft 365, OneDrive, Wealthbox. Each connector title has the same "i" icon treatment now. |
| 08 | `08-connector-m365-outlook.jpeg` | Settings → Account → Connections: the Microsoft 365 (Outlook) email connector card, same sweep. |
| 09 | `09-connector-wealthbox.jpeg` | Same Connections screen, scrolled to Wealthbox (already connected in this demo workspace) — same sweep, shown mid-list among the other connector cards. |

## Honest notes — anything that looked off

- Nothing visually broken found: no overlapping text, no misaligned icons, no missing
  icons across any of the 10 screens above. The "i" icons line up consistently at the
  same size/position next to every heading they sit beside, in both light-background
  settings panels and the gradient onboarding scenes.
- One deliberate skip: the brief asked for a 4th onboarding shot of the standalone
  "paste your API key" card (`ApiKeySetupCard`, shown in the main panel before any AI
  key is configured). Triggering it live would have required clearing this shared demo
  bench's real, keychain-stored API key — not worth the risk of disrupting other
  in-flight test runs for one supplementary shot. Shot 05 already shows the same
  key-paste UI inline as part of the "Connect your AI" onboarding step.
- The BEFORE shot (00) is reused from an earlier QA pass (`qa1-20260704/41-settings-ai-privacy.jpeg`)
  rather than freshly captured from main-tip today — it's the same screen, same app,
  just from two days earlier, which is a fair comparison for a UI-only branch.
