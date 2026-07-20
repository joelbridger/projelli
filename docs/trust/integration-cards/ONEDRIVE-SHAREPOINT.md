# OneDrive and SharePoint Integration Honesty Card

Last verified: 2026-07-10

Status: Shipping

This connector reads documents from Microsoft OneDrive and SharePoint. It does not upload, edit, or delete anything in Microsoft.

## What this connector reads

From Microsoft Graph:

- Drives: `id`, `name`, `webUrl`, and `driveType`.
- Drive items: `id`, `name`, `parentReference`, `file`, `folder`, `size`, `lastModifiedDateTime`, `eTag`, `cTag`, `webUrl`, `remoteItem`, and `deleted`.
- SharePoint site id when Microsoft includes it in a drive item's `parentReference`.
- Delta pages for root folders, including `@odata.nextLink` and `@odata.deltaLink`.
- File bytes through `/items/{id}/content` for supported files.

Supported file types:

- Text extraction: `.docx`, `.xlsx`, `.pptx`, `.rtf`, `.txt`, `.text`, `.md`, and `.markdown`.
- PDF handling: mapped `.pdf` files are imported as local files. Direct connector text indexing for unmapped `.pdf` files is recorded as pending PDF work, not silently treated as unsupported.
- Unsupported files are recorded as unsupported and are not indexed.

On this device:

- Folder mappings from Microsoft folders to Advisor Prep Hero clients.
- Sync metadata: source id, drive id, site id, item id, file name, parent path, web URL, remote signature, content hash, client id, indexed flag, pending PDF flag, deleted flag, cursor, and local imported path when one exists.

## What this connector writes

In Microsoft OneDrive or SharePoint:

- Nothing. The connector has no Microsoft Graph write path.

On this device:

- Encrypted sync metadata in the local OneDrive database.
- Encrypted search chunks for unmapped or RAG-only downloaded files.
- Local imported copies for mapped client folders, under the client's workspace folder in a `OneDrive` subfolder.
- Local cleanup on remote delete: if Microsoft reports an item deleted, Advisor Prep Hero marks the local item deleted, removes its connector search chunks, and removes its owned imported local copy when one was recorded.

## What this connector can never touch

- It cannot upload files to OneDrive or SharePoint.
- It cannot edit Microsoft files.
- It cannot delete Microsoft files.
- It cannot create Microsoft folders.
- It cannot change Microsoft sharing settings, permissions, owners, labels, or retention.
- It cannot write outside the active Advisor Prep Hero workspace. Folder and file path segments are sanitized before local import.
- It does not overwrite a user-owned local file. If a same-name local file exists and Advisor Prep Hero does not already own that imported copy, it writes a conflict copy instead.

## How writes are gated

- Remote writes: Not available.
- Local imports: Run only after the advisor connects Microsoft and starts OneDrive/SharePoint sync.
- Local file import: Happens only for mapped folders with a client destination. The files are namespaced under `OneDrive`.
- Receipt: The sync report records seen, downloaded, imported, indexed, skipped unchanged, removed, pending PDF, unsupported, repaired, and cancelled counts.
- Disconnect: Local imported data is deleted only through the disconnect flow. Imported files in client folders are deleted only when the user chooses the delete-files option. If cleanup cannot finish safely, Advisor Prep Hero keeps the Microsoft connection so the user can retry deletion.

## Limits worth knowing

- The connector uses Microsoft OAuth scopes for file and site reading: `Files.Read.All` and `Sites.Read.All`.
- Personal OneDrive and business drives are handled differently because Microsoft exposes them differently.
- A sync can be stopped. If stop lands after a download but before the local write, Advisor Prep Hero does not commit that local file write.

<!--
Evidence:
- src/features/onedrive/README.md
- src-tauri/src/commands/onedrive/client.rs
- src-tauri/src/commands/onedrive/commands.rs
- src-tauri/src/commands/onedrive/engine.rs
- src-tauri/src/commands/onedrive/model.rs
- src-tauri/src/commands/onedrive/oauth.rs
- src-tauri/src/commands/onedrive/render.rs
- src-tauri/src/commands/onedrive/source.rs
- src-tauri/src/commands/onedrive/store.rs
-->
