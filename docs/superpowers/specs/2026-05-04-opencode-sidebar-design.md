# OpenCode Sidebar — Design

**Date:** 2026-05-04
**Status:** Approved (brainstorming → planning)

## Goal

Build a VS Code sidebar extension that acts as a **frontend** for the `opencode` CLI. The extension does not implement any agent logic — it spawns `opencode serve`, talks to its HTTP+SSE API, and renders the resulting events as a modern chat UI. Authentication, providers (OpenAI/Anthropic/etc.), tool execution, and session storage all stay inside opencode.

## Choices made during brainstorming

| Decision | Choice |
|---|---|
| Integration mode | `opencode serve` (HTTP + SSE) |
| Session model | Multi-session with a pinned, always-visible list |
| Layout | Header → session list → flat message stream → composer |
| Tool-call rendering | Expanded inline cards with live streaming output, diffs for edits |
| Permission prompts | Inline yellow card showing the diff/command + Allow / Allow once / Deny |
| Theming | Inherits VS Code colors via theme tokens; Shiki for code |
| Working directory | VS Code workspace root (first folder if multi-root) |
| Target | Desktop VS Code (Node.js extension host); not web/vscode.dev |

## Architecture

Three processes, three boundaries:

```
┌────────────── VS Code ──────────────┐
│  Extension host (Node)  ─── spawn ─►│  opencode serve
│        │ postMessage    ◄── HTTP+SSE│  127.0.0.1:<random>
│        ▼                             │
│  Webview (chat UI)                   │
└──────────────────────────────────────┘
```

**Key boundary:** the webview never talks to `opencode serve` directly. It uses `postMessage` to the extension host, which proxies HTTP and forwards SSE events back. This keeps the webview CSP tight and makes "attach to remote opencode" (a future feature) a one-file change to `serverProcess.ts`.

**Server lifecycle:** spawn `opencode serve --port 0 --hostname 127.0.0.1` lazily on first sidebar resolve. Capture port from stdout, health-check, store URL. `deactivate()` sends SIGTERM, falls back to SIGKILL after 2s. Sessions persist on disk inside opencode's storage, so history survives across VS Code restarts.

**File layout:**
```
src/
  extension.ts                  # activate/deactivate, registers SidebarProvider
  sidebar/
    SidebarProvider.ts          # implements WebviewViewProvider
    messageBridge.ts            # postMessage dispatch + SSE forwarding
  opencode/
    serverProcess.ts            # spawn / health-check / teardown
    apiClient.ts                # typed HTTP wrappers (sessions, messages, perms)
    sseClient.ts                # SSE parser + reconnect with backoff
    types.ts                    # event/message shape types
  webview/
    index.html, main.ts, ui.css # built by esbuild into dist/webview/
    components/                 # SessionList, MessageList, ToolPart, PermissionPart, Composer, Header
    state.ts                    # client-side state machine (events → DOM)
    highlight.ts                # Shiki integration
```

## UI structure

One `WebviewView` with four stacked regions:

1. **Header** — "OpenCode" title, `+` (new session), `⚙` (open settings).
2. **Session list** — pinned at top, scrollable when overflowing, max ~30% of height. One row per session: title + relative timestamp.
3. **Message stream** — flex:1, scrollable. Renders flat (non-bubbled) messages with role labels, with `ToolPart` and `PermissionPart` interleaved. Auto-scrolls when user is within 100px of bottom; otherwise pins position and shows a "↓ jump to latest" pill.
4. **Composer** — textarea (auto-grows to 6 rows), model picker, Send button. Enter sends, Shift-Enter newline. While streaming, Send is replaced by **Stop**. Each completed assistant turn gets a small Copy button.

**Components** (small, single-purpose):

| Component | Responsibility |
|---|---|
| `SessionList` | Renders rows, fires `selectSession` / `deleteSession`. |
| `MessageList` | Flat list of message parts; owns auto-scroll behavior. |
| `TextPart` | Markdown → HTML; code blocks routed to `highlight.ts`. |
| `ToolPart` | Expanded card: header (name + status + duration) + body (args + streaming output, or diff for edits). |
| `PermissionPart` | Yellow card with diff/command and three action buttons. |
| `Composer` | Textarea + model picker + Send/Stop. |
| `Header` | Title, new session, open settings. |

**State model** (`state.ts`):
```ts
type State = {
  sessions: Session[];
  activeSessionId: string | null;
  messagesById: Map<string, MessagePart[]>;
  pendingPermission: PermissionRequest | null;
  composer: { text: string; model: string };
  status: 'idle' | 'streaming' | 'error';
};
```
SSE events from the bridge mutate state; components subscribe to slices. Vanilla TS with a tiny event emitter — no framework.

**Markdown + code:** Shiki configured to read VS Code's current theme via the `--vscode-editor-*` CSS variables, so highlighting follows the editor theme automatically.

**Empty + error states:**
- **No session yet** (first launch): the message stream area shows a centered "Start a new chat" with a button that triggers `newSession`.
- **Server failed to start:** message stream replaced by a centered error card showing the reason (binary not found, port bind failure, etc.) and a "Retry" button that calls the new `opencode.restartServer` command.
- **SSE disconnected** (mid-conversation): a thin yellow strip appears above the composer ("Reconnecting…") while `sseClient.ts` retries; clears on reconnect.

## Data flow

**Outbound (user → server):**
```
Composer → postMessage{type:'send', sessionId, text, model}
        → messageBridge → POST /session/<id>/message
        → opencode serve
```

**Inbound (server → UI):** the extension subscribes to `GET /event` (one stream covers all sessions) and re-subscribes on every reconnect. Forwarded events:

| SSE event | UI effect |
|---|---|
| `session.updated` | Update row in SessionList |
| `session.deleted` | Remove row, switch to most recent if active |
| `message.updated` | Ensure message slot exists in `messagesById` |
| `message.part.updated` | Replace the part in state (server sends full current content per chunk) |
| `message.removed` | Remove from state |
| `permission.updated` | Set `pendingPermission`, render `PermissionPart` |
| `permission.replied` | Clear pending, mark tool approved/denied |

**Bridge protocol** (postMessage between extension and webview):
```ts
type EventToWebview =
  | { type: 'ready', sessions: Session[], activeSessionId: string | null }
  | { type: 'sse', event: OpenCodeEvent }
  | { type: 'http-result', requestId: string, ok: boolean, data: unknown }
  | { type: 'error', requestId?: string, message: string };

type EventFromWebview =
  | { type: 'send', sessionId: string, text: string, model: string }
  | { type: 'stop', sessionId: string }
  | { type: 'newSession' }
  | { type: 'switchSession', sessionId: string }
  | { type: 'deleteSession', sessionId: string }
  | { type: 'permissionReply', permissionId: string, decision: 'allow'|'once'|'deny' }
  | { type: 'http', requestId: string, method: string, path: string, body?: unknown };
```

**Streaming (the subtle part):** opencode sends `message.part.updated` with the full current content of a part on each chunk, not deltas. The reducer is `parts[partId] = event.part` — no delta math.

**Reconnect:** if SSE drops, `sseClient.ts` retries with exponential backoff (1s → 2s → 4s, max 30s). On reconnect, re-fetch the active session's full message list to recover anything missed.

**Cancellation:** Stop button → `POST /session/<id>/abort`. Server flushes any in-flight tool, emits `message.updated` with `aborted` status, stops further parts. UI shows partial content as final.

## Permission handling

Lifecycle of one permission request:

1. Server emits `permission.updated` over SSE with `{id, sessionID, type, pattern, title, metadata}`. Tool execution is paused server-side until reply.
2. Webview sets `pendingPermission`; `MessageList` renders a `PermissionPart` inline at the bottom of the active assistant turn — not in a modal (modals would steal editor focus).
3. User clicks → webview sends `permissionReply` → extension calls `POST /session/<id>/permissions/<permId>` with `{response: 'always'|'once'|'reject'}`.
4. Server resumes the tool, emits `permission.replied`; UI clears `pendingPermission`.

**Three buttons map to opencode's three responses:**
- **Allow** → `always` — opencode remembers the pattern for the session, won't ask again for matches.
- **Allow once** → `once` — approves this single call.
- **Deny** → `reject` — tool errors back to the agent.

**Edge cases:**
- **Stale prompts on panel reopen:** SSE replay re-emits `permission.updated`; we render normally.
- **Multi-client races:** if another opencode client (CLI, web) answers first, we receive `permission.replied` with a decision we didn't make → silently clear `pendingPermission`.
- **Per-session attachment:** if user switches sessions while a prompt is pending, the prompt stays attached to its session and reappears when they switch back.
- **Keyboard:** Enter on visible permission card defaults to **Allow once** (safer than `always`); Esc denies.

## Settings

Contributed via `package.json` → `contributes.configuration`:

- `opencode.binaryPath` — defaults to `opencode` on PATH.
- `opencode.serverArgs` — array of extra args passed to `opencode serve` (e.g., `["--log-level", "DEBUG"]`).
- `opencode.defaultModel` — model used for new sessions; falls back to opencode's own default if unset.

## Pre-existing fixes folded into this work

The current `package.json` and `src/extension.ts` are skeletons. These problems are fixed in-place because the same files are being rewritten:

- `package.json`: `"views"` is currently outside `"contributes"` — move inside (the sidebar likely doesn't register today).
- `package.json`: add an `"icon"` to the activitybar viewsContainer (currently no icon).
- `package.json`: add the `contributes.configuration` block above.
- `package.json`: add commands `opencode.newSession`, `opencode.openSettings`, `opencode.restartServer`, plus a Command Palette entry for focusing the sidebar.
- `src/extension.ts`: register provider via `vscode.window.registerWebviewViewProvider`; wire `activate`/`deactivate` for server lifecycle.

## Testing

- **Unit tests for `state.ts`** — every SSE-event-to-state transition. Pure functions, no VS Code dependency. This covers the trickiest logic.
- **Unit test for `sseClient.ts`** — reconnect/backoff against a fake event source.
- **Unit test for `apiClient.ts`** — request shape correctness against a mocked HTTP server.
- **One integration test (vscode-test)** — activate the extension, open the sidebar, assert the webview HTML mounts. Smoke level only.

Full E2E against a real opencode server is out of scope for v1.

## Out of scope (v1)

- File attachments (`@file` mentions, drag-drop).
- Image / screenshot input.
- "Attach to remote opencode server" UX (architecture supports it; no UI yet).
- Custom permission policy editor.
- Slash commands palette.
- Streaming token rate / cost display.
- Multi-root workspace handling (uses first folder only).
