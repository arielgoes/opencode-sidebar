# Implementation Plan: OpenCode Diff Panel

## Overview

Add a bottom-panel webview to the opencode-sidebar VS Code extension that displays proposed code changes from the LLM as per-hunk diff blocks with Accept/Reject/Edit buttons. Changes are applied via `vscode.workspace.applyEdit()` only after user approval.

**Design decisions:**
- **Approach:** Hybrid webview diff panel (Approach C)
- **Placement:** Bottom panel (like terminal), chat stays in sidebar
- **Granularity:** Per-hunk (like git diff hunks)
- **Rendering:** Shiki syntax highlighting + custom diff styling (reuses existing highlighter)
- **Server integration:** Uses existing opencode `serve` SSE events — no new server endpoints needed

---

## Architecture

### Data Flow

```
opencode serve → SSE stream → SidebarProvider → DiffPanel webview
                                                    ↓
                                          User clicks Accept/Reject
                                                    ↓
                                          DiffApplier → WorkspaceEdit → VS Code editor
```

### Key opencode Server APIs Used

**SSE Events (already streamed to extension):**
- `message.part.updated` — `ToolPart` with `state.status === "completed"` contains file edit tool output
- `session.diff` — `Array<FileDiff>` with `{ file, before, after, additions, deletions }`
- `session.status` — `busy`/`idle`/`retry` for processing state

**REST Endpoints:**
- `GET /session/{id}/messages` — returns messages with parts including tool outputs
- `FileContent` type includes `patch.hunks` with `{ oldStart, oldLines, newStart, newLines, lines }`

**No new server endpoints are needed.** All diff data comes from existing SSE events and REST API responses.

### Component Structure

```
src/
├── sidebar/
│   ├── bridgeProtocol.ts          # ADD: DiffPanel events to/from webview
│   ├── messageBridge.ts           # EXTEND: Route diff events to DiffPanel
│   └── SidebarProvider.ts         # EXTEND: Create/manage DiffPanel lifecycle
├── diff/
│   ├── DiffPanel.ts               # NEW: VS Code webview panel (extension side)
│   ├── DiffApplier.ts             # NEW: Apply accepted hunks via WorkspaceEdit
│   └── DiffParser.ts              # NEW: Parse unified diffs into hunk structures
├── webview/
│   └── diff/
│       ├── main.ts                # NEW: Webview entry point for diff panel
│       ├── DiffRenderer.ts        # NEW: Render diff blocks with Shiki
│       ├── DiffBlock.ts           # NEW: Individual hunk card component
│       ├── index.html             # NEW: HTML template for diff panel
│       └── diff.css               # NEW: Styles for diff panel
└── webview/state.ts               # EXTEND: Add diff state to store
```

---

## Implementation Tasks

### Task 1: Extend Bridge Protocol

**File:** `src/sidebar/bridgeProtocol.ts`

Add new event types for diff panel communication:

```typescript
// EventToWebview additions:
| { type: 'diffPanel.open'; blocks: DiffBlock[] }
| { type: 'diffPanel.update'; blockId: string; block: DiffBlock }
| { type: 'diffPanel.close' }

// EventFromWebview additions:
| { type: 'diff.accept'; blockId: string }
| { type: 'diff.reject'; blockId: string }
| { type: 'diff.acceptAll' }
| { type: 'diff.rejectAll' }
| { type: 'diff.edit'; blockId: string; newContent: string }

// New type:
interface DiffBlock {
  id: string;
  file: string;
  hunkIndex: number;
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  status: 'pending' | 'accepted' | 'rejected';
}
```

### Task 2: Create Diff Parser

**File:** `src/diff/DiffParser.ts`

Parse unified diff patches into structured hunk data:

- Input: unified diff string (from `FileContent.patch` or tool output)
- Output: `Array<DiffBlock>` with per-hunk granularity
- Handle: additions, deletions, context lines, file renames
- Use existing `FileDiff` type from SDK: `{ file, before, after, additions, deletions }`

### Task 3: Create DiffPanel (Extension Side)

**File:** `src/diff/DiffPanel.ts`

VS Code webview panel that manages the bottom panel:

- Create panel via `vscode.window.createWebviewPanel()` with `ViewColumn.Below`
- Load HTML from `src/webview/diff/index.html`
- Handle messages from webview (accept/reject/edit)
- Forward accepted blocks to `DiffApplier`
- Auto-open when `session.diff` or completed `ToolPart` events arrive
- Auto-close when all blocks are resolved or session ends
- Expose `open()`, `close()`, `updateBlocks()` methods

### Task 4: Create DiffApplier

**File:** `src/diff/DiffApplier.ts`

Apply accepted/rejected hunks to actual files:

- Use `vscode.workspace.applyEdit()` with `WorkspaceEdit`
- For each accepted hunk:
  - Read current file content
  - Replace old lines with new lines at correct position
  - Handle line number shifts from prior hunks
- For rejected hunks: skip (original code preserved)
- Support partial application (some hunks accepted, some rejected)
- Integrate with VS Code undo/redo stack

### Task 5: Create DiffPanel Webview

**Files:** `src/webview/diff/main.ts`, `src/webview/diff/index.html`, `src/webview/diff/diff.css`

Webview entry point and HTML template:

- Mount `DiffRenderer` component
- Subscribe to messages from extension (`EventToWebview`)
- Post user actions back to extension (`EventFromWebview`)
- Use VS Code webview API for theming (`vscode-webview` CSS variables)
- Match VS Code dark/light theme automatically

### Task 6: Create DiffRenderer Component

**File:** `src/webview/diff/DiffRenderer.ts`

Render the list of diff blocks:

- Group blocks by file
- Show file header with change count
- Render each block via `DiffBlock` component
- Show summary bar with "Accept All" / "Reject All" buttons
- Update block states in real-time as user interacts
- Use existing Shiki highlighter from `src/webview/highlight.ts`

### Task 7: Create DiffBlock Component

**File:** `src/webview/diff/DiffBlock.ts`

Individual hunk card with accept/reject/edit:

- Show file path and line range
- Render old lines (red background, strikethrough) and new lines (green background)
- Syntax highlight code using Shiki
- Buttons: Accept, Reject, Edit
- Visual states: pending (yellow border), accepted (green), rejected (red, faded)
- Edit mode: inline textarea for modifying proposed content before accepting

### Task 8: Extend State Management

**File:** `src/webview/state.ts`

Add diff state to the existing store:

```typescript
interface DiffState {
  blocks: Map<string, DiffBlock>;
  blocksByFile: Map<string, string[]>; // file -> blockIds
  panelVisible: boolean;
}
```

- Extend `reduce()` function to handle `diffPanel.*` events
- Track block status changes (pending → accepted/rejected)
- Derive counts for summary bar (accepted, rejected, pending)

### Task 9: Integrate with SidebarProvider

**File:** `src/sidebar/SidebarProvider.ts`

- Add `DiffPanel` instance management
- Subscribe to SSE events and forward relevant ones to `DiffPanel`
- On `message.part.updated` with completed `ToolPart` (file edit tool):
  - Parse tool output for diff content
  - Create `DiffBlock[]` and send to panel
- On `session.diff` event:
  - Use `FileDiff` data to create blocks
  - Send to panel
- On `session.idle`:
  - If all blocks resolved, close panel
  - If unresolved blocks remain, keep panel open

### Task 10: Extend MessageBridge

**File:** `src/sidebar/messageBridge.ts`

- Add handling for `diff.*` events from webview
- Route `diff.accept` to `DiffApplier.applyBlock()`
- Route `diff.reject` to mark block as rejected
- Route `diff.edit` to update block content then apply
- Route `diff.acceptAll` / `diff.rejectAll` to batch operations

### Task 11: Add Configuration

**File:** `package.json` (contributes.configuration)

Add settings:

```json
"opencode.diffPanel.autoOpen": {
  "type": "boolean",
  "default": true,
  "description": "Automatically open the diff panel when changes are proposed."
},
"opencode.diffPanel.showInlineEdit": {
  "type": "boolean",
  "default": true,
  "description": "Show edit button to modify proposed changes before accepting."
}
```

### Task 12: Add Tests

**Files:** `src/test/diffParser.test.ts`, `src/test/diffApplier.test.ts`

- Test `DiffParser` with various unified diff formats
- Test `DiffApplier` with single/multiple hunks, edge cases
- Test state reducer with diff events
- Test bridge message routing

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/sidebar/bridgeProtocol.ts` | Modify | Add diff event types |
| `src/sidebar/messageBridge.ts` | Modify | Route diff messages |
| `src/sidebar/SidebarProvider.ts` | Modify | Manage DiffPanel lifecycle |
| `src/diff/DiffPanel.ts` | New | Extension-side webview panel |
| `src/diff/DiffApplier.ts` | New | Apply changes via WorkspaceEdit |
| `src/diff/DiffParser.ts` | New | Parse unified diffs into hunks |
| `src/webview/diff/main.ts` | New | Webview entry point |
| `src/webview/diff/DiffRenderer.ts` | New | Render diff block list |
| `src/webview/diff/DiffBlock.ts` | New | Individual hunk card component |
| `src/webview/diff/index.html` | New | HTML template |
| `src/webview/diff/diff.css` | New | Diff panel styles |
| `src/webview/state.ts` | Modify | Add diff state |
| `src/webview/highlight.ts` | Reuse | Existing Shiki highlighter |
| `package.json` | Modify | Add config settings, build entries |
| `esbuild.js` | Modify | Bundle diff webview |
| `src/test/diffParser.test.ts` | New | Parser tests |
| `src/test/diffApplier.test.ts` | New | Applier tests |

---

## Dependencies

- **Existing:** `@opencode-ai/sdk` (types: `FileDiff`, `FileContent`, `ToolPart`, `Part`)
- **Existing:** `marked`, `shiki` (already in package.json)
- **New:** None — all functionality uses existing dependencies

---

## Build Changes

**File:** `esbuild.js`

- Add entry point for `src/webview/diff/main.ts` → `dist/webview/diff.js`
- Update `package` script to include diff webview bundle

**File:** `package.json`

- Add `opencode.diffPanel.*` configuration entries
- No new npm dependencies

---

## Notes

- The opencode server **already applies changes** when the LLM calls edit tools (with permission). This diff panel provides a **pre-approval review** layer — users see proposed changes before they hit the filesystem.
- If `permission.edit` is set to `"allow"` in opencode config, the server applies changes automatically. The diff panel still shows them for review, but they may already be applied. This is a known limitation — users should set `permission.edit: "ask"` for full pre-approval workflow.
- The panel uses the same Shiki highlighter as the sidebar chat, ensuring consistent code rendering.
- All diff data comes from existing SSE events — no server-side changes required.
