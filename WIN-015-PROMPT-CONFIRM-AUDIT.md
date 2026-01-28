# WIN-015: Audit of window.prompt() and window.confirm() Usage

**Date:** 2026-01-28
**Status:** Complete
**Total Usages Found:** 18

## Summary

This audit documents all usages of `window.prompt()` and `window.confirm()` in the Projelli codebase. These browser APIs work in Tauri's WebView, but they feel non-native and don't match the Windows desktop UX. This document categorizes each usage by criticality and provides recommendations for future improvements.

## Findings

### window.confirm() Usage (8 instances)

#### HIGH PRIORITY - Delete Operations
These are destructive actions that should have native confirmation dialogs:

1. **FileTree.tsx:167** - Confirm file/folder deletion
   - Context: FileTree context menu delete action
   - Current: "Are you sure you want to delete..."
   - Recommendation: Create custom ConfirmDialog component with better UX
   - Impact: HIGH - Prevents accidental data loss

2. **App.tsx:279** - Confirm file deletion
   - Context: Delete file from workspace
   - Current: "Are you sure you want to delete..."
   - Recommendation: Use custom ConfirmDialog
   - Impact: HIGH - Critical safety feature

#### MEDIUM PRIORITY - State Change Operations
These operations change UI state but aren't destructive:

3. **TabGroupManager.tsx:66** - Delete tab group
   - Context: Remove tab group (tabs remain open)
   - Current: "Delete this tab group? Tabs will remain open."
   - Recommendation: Custom dialog or accept as-is
   - Impact: MEDIUM - Not data destructive

4. **TabBar.tsx:118** - Close tab with unsaved changes
   - Context: Prevent closing unsaved tab
   - Current: "This file has unsaved changes. Close anyway?"
   - Recommendation: Custom dialog with Save/Don't Save/Cancel options
   - Impact: MEDIUM - Data loss prevention

5. **TabBar.tsx:342** - Delete tab group
   - Context: Same as #3, different location
   - Recommendation: Custom dialog or accept as-is
   - Impact: MEDIUM

6. **Whiteboard.tsx:1206** - Clear whiteboard
   - Context: Clear all whiteboard content
   - Current: "Clear the whiteboard?"
   - Recommendation: Custom dialog
   - Impact: MEDIUM - Can be undone via version history

#### LOW PRIORITY - Version History Operations
These have built-in recovery mechanisms:

7. **VersionHistoryPanel.tsx:42** - Restore version
   - Context: Restore file to previous version
   - Current: "Restore file to version from..."
   - Recommendation: Accept as-is (low frequency operation)
   - Impact: LOW - Can be undone

8. **VersionHistoryPanel.tsx:52** - Delete version
   - Context: Delete version from history
   - Current: "Delete this version?"
   - Recommendation: Accept as-is (low frequency operation)
   - Impact: LOW - Other versions remain

### window.prompt() Usage (10 instances)

#### HIGH PRIORITY - File/Folder Creation
These are core workflow operations that would benefit from better UX:

1. **App.tsx:513** - Create new file
   - Context: New file in file tree
   - Current: "Enter file name:"
   - Recommendation: Custom modal with input field, file type selection, and validation
   - Impact: HIGH - Frequent operation

2. **App.tsx:532** - Create new folder
   - Context: New folder in file tree
   - Current: "Enter folder name:"
   - Recommendation: Custom modal with input field and validation
   - Impact: HIGH - Frequent operation

3. **App.tsx:683** - Create template file
   - Context: Create new template
   - Current: "Enter file name:"
   - Recommendation: Custom modal
   - Impact: HIGH - Core feature

4. **App.tsx:700** - Create source file
   - Context: Create new research source
   - Current: "Enter file name (without extension):"
   - Recommendation: Custom modal with URL input and metadata fields
   - Impact: HIGH - Core research feature

5. **App.tsx:718** - Create aichat file
   - Context: Create new AI chat
   - Current: "Enter file name (without extension):"
   - Recommendation: Custom modal
   - Impact: HIGH - Core AI feature

6. **App.tsx:736** - Create source from clipboard
   - Context: Quick source creation from URL
   - Current: "Enter source title:"
   - Recommendation: Custom modal with title and URL inputs
   - Impact: HIGH - Frequent operation

7. **App.tsx:778** - Create folder from command
   - Context: Command palette create folder
   - Current: "Enter folder name:"
   - Recommendation: Custom modal
   - Impact: HIGH - Core operation

#### MEDIUM PRIORITY - Rename Operations
Less frequent but still important:

8. **App.tsx:557** - Rename file/folder
   - Context: Rename operation
   - Current: "Enter new name:" with default value
   - Recommendation: Custom modal with validation
   - Impact: MEDIUM - Less frequent but important

#### LOW PRIORITY - Whiteboard Operations
Nice-to-have improvements:

9. **App.tsx:800** - Save whiteboard
   - Context: Save whiteboard to file
   - Current: "Enter whiteboard name:" with default
   - Recommendation: Custom modal
   - Impact: LOW - Has default value

10. **App.tsx:822** - Create new whiteboard
    - Context: Create whiteboard from command palette
    - Current: "Enter whiteboard name:" with default
    - Recommendation: Custom modal
    - Impact: LOW - Has default value

## Recommendations

### Phase 1: Critical Replacements (Pre-v1.0)
Focus on destructive operations:
1. Create `ConfirmDialog` component for delete operations
2. Replace file/folder delete confirmations (FileTree.tsx, App.tsx)
3. Add "Save/Don't Save/Cancel" dialog for unsaved tab closing

### Phase 2: Enhanced UX (Post-v1.0)
Improve frequent operations:
1. Create `PromptDialog` component for text input
2. Replace all file/folder creation prompts with custom modals
3. Add input validation (filename characters, duplicates, etc.)
4. Consider file type templates in creation dialog

### Phase 3: Polish (Future)
Nice-to-have improvements:
1. Replace remaining prompts/confirms
2. Add keyboard shortcuts to all dialogs
3. Consider Tauri native dialogs for simple cases

## Tauri Native Dialog Option

For simple confirmations, Tauri provides native dialog APIs:

```typescript
import { ask, message } from '@tauri-apps/plugin-dialog';

// Simple confirmation
const confirmed = await ask('Delete this file?', {
  title: 'Confirm Delete',
  type: 'warning',
});

// Simple message
await message('File deleted successfully', { title: 'Success', type: 'info' });
```

**Pros:**
- Native Windows look and feel
- No custom UI needed
- Platform-consistent

**Cons:**
- Less customizable
- Limited styling options
- Browser mode requires custom fallback

**Recommendation:** Use Tauri native dialogs for simple yes/no confirmations in future releases, but custom React modals remain best for complex inputs and better browser/Tauri consistency.

## Implementation Priority

For v1.0 Windows release:
- ✅ All browser APIs replaced with cross-platform alternatives
- ⏸️ window.prompt() and window.confirm() work in Tauri (ACCEPTABLE)
- 🔮 Custom dialogs are a v1.1+ enhancement

**Decision:** These dialogs are not blockers for v1.0. They work in Tauri WebView, just don't feel as native. Can be enhanced post-launch.

## Conclusion

**Total Assessed:** 18 usages
- **Blocking for launch:** 0
- **High priority for v1.1:** 11 (delete confirmations, file/folder creation)
- **Medium priority:** 5 (tab management, rename)
- **Low priority:** 2 (whiteboard naming)

**Status:** ✅ ACCEPTABLE FOR V1.0
All window.prompt() and window.confirm() calls work correctly in Tauri. No blockers for Windows desktop release.
