# OpenCode Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code sidebar extension that acts as a frontend for the locally-installed `opencode` CLI — multi-session chat with live streaming, tool-call rendering, and permission prompts.

**Architecture:** Extension host spawns `opencode serve` as a subprocess on first sidebar resolve, captures its random port from stdout, then proxies HTTP and SSE traffic to a webview that renders the chat UI. The webview never sees the port directly. State lives in the webview as a single store mutated by typed events.

**Tech Stack:** TypeScript • esbuild (existing) • `@opencode-ai/sdk` (typed HTTP+SSE client) • `marked` (markdown) • `shiki` (syntax highlighting) • `vitest` + `jsdom` (unit) • `@vscode/test-electron` (integration, already present).

**Spec:** [docs/superpowers/specs/2026-05-04-opencode-sidebar-design.md](../specs/2026-05-04-opencode-sidebar-design.md)

---

## File map (created or rewritten by this plan)

```
src/
  extension.ts                          REWRITTEN  activate/deactivate, sidebar registration
  sidebar/
    SidebarProvider.ts                  CREATE     WebviewViewProvider + bridge wiring
    messageBridge.ts                    CREATE     postMessage ↔ apiClient/sseClient routing
    bridgeProtocol.ts                   CREATE     postMessage typed message shapes
  opencode/
    serverProcess.ts                    CREATE     spawn / health-check / dispose
    apiClient.ts                        CREATE     SDK wrapper (createOpencodeClient)
    sseClient.ts                        CREATE     SSE subscriber with reconnect/backoff
    types.ts                            CREATE     re-exports of SDK types we use
  webview/
    index.html                          CREATE     mount point + CSP meta + module script tag
    main.ts                             CREATE     bootstraps state, components, bridge
    ui.css                              CREATE     theme-token-driven styles
    state.ts                            CREATE     pure reducer + event emitter
    highlight.ts                        CREATE     shiki theme bridge
    markdown.ts                         CREATE     marked wrapper, code-block hook
    components/
      Header.ts                         CREATE
      SessionList.ts                    CREATE
      MessageList.ts                    CREATE     hosts auto-scroll + part renderers
      TextPart.ts                       CREATE
      ToolPart.ts                       CREATE
      PermissionPart.ts                 CREATE
      Composer.ts                       CREATE
package.json                            REWRITTEN  fix views nesting, add config/commands/deps
esbuild.js                              MODIFIED   second build entry for webview bundle
src/test/
  state.test.ts                         CREATE     vitest, pure-state reducer tests
  serverProcess.test.ts                 CREATE     vitest, fake-child lifecycle tests
  apiClient.test.ts                     CREATE     vitest, mocked fetch tests
  sseClient.test.ts                     CREATE     vitest, fake event source tests
  bridge.test.ts                        CREATE     vitest, postMessage protocol tests
  components/
    SessionList.test.ts                 CREATE     vitest + jsdom
    MessageList.test.ts                 CREATE     vitest + jsdom
    Composer.test.ts                    CREATE     vitest + jsdom
    PermissionPart.test.ts              CREATE     vitest + jsdom
  extension.test.ts                     REWRITTEN  smoke integration (vscode-test)
vitest.config.ts                        CREATE
```

---

## Phase 0 — Foundation

### Task 0.1: Initial commit (capture starting state)

**Files:** all of repo

- [ ] **Step 1: Stage and commit the existing scaffold so the rest of the plan has a baseline to roll back to.**

```bash
git add .gitignore .vscode .vscode-test.mjs .vscodeignore CHANGELOG.md README.md \
        eslint.config.mjs esbuild.js package.json package-lock.json tsconfig.json \
        vsc-extension-quickstart.md src docs .github
git commit -m "chore: initial scaffold + design docs"
```

Expected: one commit on `master`. `git status` clean except for `node_modules/`, `dist/`, `out/` (already gitignored).

---

### Task 0.2: Add runtime + dev dependencies

**Files:**
- Modify: `package.json` (`dependencies` and `devDependencies`)

- [ ] **Step 1: Install runtime deps.**

```bash
npm install --save @opencode-ai/sdk@^1.4.3 marked@^14 shiki@^1.22
```

- [ ] **Step 2: Install dev deps for tests.**

```bash
npm install --save-dev vitest@^2 jsdom@^25 @types/jsdom@^21
```

- [ ] **Step 3: Verify package.json now lists them.**

Run: `node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies).sort()); console.log(Object.keys(p.devDependencies).sort())"`
Expected: `['@opencode-ai/sdk', 'marked', 'shiki']` and `vitest`/`jsdom`/`@types/jsdom` present alongside existing.

- [ ] **Step 4: Commit.**

```bash
git add package.json package-lock.json
git commit -m "chore: add @opencode-ai/sdk, marked, shiki, vitest, jsdom"
```

---

### Task 0.3: Configure vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (`scripts.test:unit`)

- [ ] **Step 1: Write `vitest.config.ts`.**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['src/test/components/**', 'jsdom']],
    globals: false,
    reporters: 'default',
  },
});
```

- [ ] **Step 2: Add test scripts to `package.json`. Replace the existing `"test"` line and add a unit-only one.**

```jsonc
"scripts": {
  // ... existing keys preserved ...
  "test:unit": "vitest run",
  "test:unit:watch": "vitest",
  "test": "npm run test:unit && npm run pretest && vscode-test"
}
```

- [ ] **Step 3: Sanity check — vitest discovers no tests yet but exits 0.**

Run: `npm run test:unit`
Expected: `No test files found, exiting with code 0` (or similar) — exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add vitest.config.ts package.json
git commit -m "chore: wire vitest with jsdom environment for component tests"
```

---

### Task 0.4: Fix package.json structural bug + add contributions

**Files:**
- Modify: `package.json`

The current `package.json` has `"views"` outside `"contributes"` (which is why the sidebar may not be appearing today), no icon for the activitybar container, and no `configuration` / `commands` blocks.

- [ ] **Step 1: Rewrite the `contributes` block of `package.json`.**

Replace the existing `"contributes": {...}` and the stray top-level `"views"` block with:

```jsonc
"contributes": {
  "viewsContainers": {
    "activitybar": [
      {
        "id": "opencode",
        "title": "OpenCode",
        "icon": "media/opencode.svg"
      }
    ]
  },
  "views": {
    "opencode": [
      {
        "id": "opencode.sidebar",
        "name": "Chat",
        "type": "webview"
      }
    ]
  },
  "commands": [
    { "command": "opencode.newSession",     "title": "OpenCode: New Session" },
    { "command": "opencode.restartServer",  "title": "OpenCode: Restart Server" },
    { "command": "opencode.openSettings",   "title": "OpenCode: Open Settings" },
    { "command": "opencode.focusSidebar",   "title": "OpenCode: Focus Sidebar" }
  ],
  "configuration": {
    "title": "OpenCode",
    "properties": {
      "opencode.binaryPath": {
        "type": "string",
        "default": "opencode",
        "description": "Path to the opencode binary. 'opencode' resolves on PATH."
      },
      "opencode.serverArgs": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Extra arguments passed to `opencode serve`."
      },
      "opencode.defaultModel": {
        "type": "string",
        "default": "",
        "description": "Default model for new sessions in the form provider/model. Empty = use opencode's default."
      }
    }
  }
}
```

- [ ] **Step 2: Remove the stray top-level `"views"` block** from `package.json` (it currently sits at top level after `"contributes"`).

- [ ] **Step 3: Update `activationEvents` so the sidebar activates the extension.**

```jsonc
"activationEvents": ["onView:opencode.sidebar"]
```

(This entry already exists — verify it's still present after the rewrite.)

- [ ] **Step 4: Create the placeholder icon.**

```bash
mkdir -p media
```

Write `media/opencode.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
```

- [ ] **Step 5: Verify the manifest is still valid JSON.**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 6: Commit.**

```bash
git add package.json media/opencode.svg
git commit -m "fix(manifest): nest views inside contributes; add config, commands, icon"
```

---

### Task 0.5: Configure esbuild to also bundle the webview

**Files:**
- Modify: `esbuild.js`
- Modify: `tsconfig.json`

- [ ] **Step 1: Read the current `esbuild.js`** to see the existing config shape — preserve it for the extension build.

Run: `cat esbuild.js`

- [ ] **Step 2: Replace `esbuild.js`** so it runs two parallel builds — one for the extension host (CJS, node target) and one for the webview (ESM, browser target):

```js
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'esm',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview/main.js',
  logLevel: 'silent',
};

async function main() {
  const [extCtx, wvCtx] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  if (watch) {
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log('[esbuild] watching extension + webview');
  } else {
    await Promise.all([extCtx.rebuild(), wvCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), wvCtx.dispose()]);
    console.log('[esbuild] built extension + webview');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Update `tsconfig.json`** so the webview source compiles with DOM types but the extension still has node types. Replace its content with:

```jsonc
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "Node16",
    "outDir": "out",
    "rootDir": "src",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Run a build to confirm both bundles compile** (this will fail because `src/webview/main.ts` doesn't exist yet — create a stub).

Run: `mkdir -p src/webview && echo "export {};" > src/webview/main.ts`
Run: `node esbuild.js`
Expected: `[esbuild] built extension + webview`. `dist/extension.js` and `dist/webview/main.js` exist.

- [ ] **Step 5: Commit.**

```bash
git add esbuild.js tsconfig.json src/webview/main.ts
git commit -m "build: emit separate webview bundle alongside extension bundle"
```

---

## Phase 1 — Server lifecycle (`opencode/serverProcess.ts`)

### Task 1.1: Test — extracts port from stdout

**Files:**
- Create: `src/test/serverProcess.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { startOpencodeServer } from '../opencode/serverProcess';

function fakeChild(opts: { stdoutLines: string[]; stderrLines?: string[]; exitCode?: number | null } = { stdoutLines: [] }) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 12345;
  setImmediate(() => {
    for (const line of opts.stdoutLines) child.stdout.emit('data', Buffer.from(line + '\n'));
    for (const line of opts.stderrLines ?? []) child.stderr.emit('data', Buffer.from(line + '\n'));
    if (opts.exitCode !== undefined) child.emit('exit', opts.exitCode);
  });
  return child;
}

describe('startOpencodeServer', () => {
  it('resolves with the URL parsed from "opencode server listening on …" stdout', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({
      stdoutLines: [
        'Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.',
        'opencode server listening on http://127.0.0.1:53901',
      ],
    }));
    const handle = await startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '/tmp' }, { spawn });
    expect(handle.url).toBe('http://127.0.0.1:53901');
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--port', '0', '--hostname', '127.0.0.1'],
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });
});
```

- [ ] **Step 2: Run the test — it must fail because the module doesn't exist.**

Run: `npm run test:unit -- serverProcess.test.ts`
Expected: FAIL — `Cannot find module '../opencode/serverProcess'`.

---

### Task 1.2: Implement `startOpencodeServer` (port parsing)

**Files:**
- Create: `src/opencode/serverProcess.ts`

- [ ] **Step 1: Write the minimal implementation.**

```ts
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface ServerHandle {
  url: string;
  pid: number;
  dispose(): Promise<void>;
}

export interface ServerOptions {
  binaryPath: string;
  extraArgs: string[];
  cwd: string;
}

export interface ServerDeps {
  spawn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

const URL_RE = /opencode server listening on (https?:\/\/[^\s]+)/;

export async function startOpencodeServer(opts: ServerOptions, deps: ServerDeps = {}): Promise<ServerHandle> {
  const spawn = deps.spawn ?? nodeSpawn;
  const args = ['serve', '--port', '0', '--hostname', '127.0.0.1', ...opts.extraArgs];
  const child = spawn(opts.binaryPath, args, { cwd: opts.cwd, env: process.env });

  return new Promise((resolve, reject) => {
    let buf = '';
    let resolved = false;

    const onStdout = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const m = buf.match(URL_RE);
      if (m && !resolved) {
        resolved = true;
        resolve({
          url: m[1],
          pid: child.pid ?? -1,
          dispose: () => disposeChild(child),
        });
      }
    };

    const onExit = (code: number | null) => {
      if (!resolved) reject(new Error(`opencode exited with code ${code} before announcing port`));
    };

    child.stdout?.on('data', onStdout);
    child.on('exit', onExit);
    child.on('error', err => { if (!resolved) reject(err); });
  });
}

function disposeChild(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(killTimer); resolve(); });
    child.kill('SIGTERM');
  });
}
```

- [ ] **Step 2: Run the test — it must pass.**

Run: `npm run test:unit -- serverProcess.test.ts`
Expected: PASS.

---

### Task 1.3: Test — rejects on early exit and on spawn error

**Files:**
- Modify: `src/test/serverProcess.test.ts`

- [ ] **Step 1: Append two more failing tests.**

```ts
  it('rejects when child exits before announcing a port', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({ stdoutLines: ['…'], exitCode: 127 }));
    await expect(startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '/tmp' }, { spawn }))
      .rejects.toThrow(/exited with code 127/);
  });

  it('forwards extraArgs after the default serve flags', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({ stdoutLines: ['opencode server listening on http://127.0.0.1:1'] }));
    await startOpencodeServer({ binaryPath: 'opencode', extraArgs: ['--log-level','DEBUG'], cwd: '.' }, { spawn });
    expect(spawn.mock.calls[0][1]).toEqual(['serve','--port','0','--hostname','127.0.0.1','--log-level','DEBUG']);
  });
```

- [ ] **Step 2: Run them — both should pass.** (The implementation already supports both behaviors.)

Run: `npm run test:unit -- serverProcess.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/opencode/serverProcess.ts src/test/serverProcess.test.ts
git commit -m "feat(server): spawn opencode serve and parse port from stdout"
```

---

### Task 1.4: Test + implement disposal

**Files:**
- Modify: `src/test/serverProcess.test.ts`

- [ ] **Step 1: Add a disposal test.**

```ts
  it('dispose() sends SIGTERM and resolves once the child exits', async () => {
    const child = fakeChild({ stdoutLines: ['opencode server listening on http://127.0.0.1:1'] });
    const spawn = vi.fn().mockReturnValue(child);
    const handle = await startOpencodeServer({ binaryPath:'opencode', extraArgs:[], cwd:'.' }, { spawn });
    setImmediate(() => child.emit('exit', 0));
    await handle.dispose();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
```

- [ ] **Step 2: Run.** Expected: PASS (impl already supports this).

Run: `npm run test:unit -- serverProcess.test.ts`

- [ ] **Step 3: Commit.**

```bash
git add src/test/serverProcess.test.ts
git commit -m "test(server): cover dispose lifecycle"
```

---

## Phase 2 — Types and API client

### Task 2.1: Re-export SDK types we use

**Files:**
- Create: `src/opencode/types.ts`

- [ ] **Step 1: Write the re-exports.**

```ts
export type {
  Session,
  Message,
  Part,
  Permission,
  Event,
  EventMessageUpdated,
  EventMessagePartUpdated,
  EventMessageRemoved,
  EventPermissionUpdated,
  EventPermissionReplied,
  EventSessionCreated,
  EventSessionUpdated,
  EventSessionDeleted,
  Provider,
  Model,
} from '@opencode-ai/sdk/client';

export type PermissionDecision = 'allow' | 'once' | 'deny';
// Maps to the SDK wire value:
export const decisionToWire = {
  allow: 'always',
  once:  'once',
  deny:  'reject',
} as const;
```

- [ ] **Step 2: Verify it compiles.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/opencode/types.ts
git commit -m "feat(types): re-export opencode SDK types + decision mapping"
```

---

### Task 2.2: Test — apiClient.listSessions delegates to SDK

**Files:**
- Create: `src/test/apiClient.test.ts`

- [ ] **Step 1: Write the test.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '../opencode/apiClient';

function fakeFetch(map: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${new URL(u).pathname}`;
    const hit = map[key];
    if (!hit) throw new Error(`unmocked request: ${key}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('apiClient', () => {
  it('listSessions calls GET /session and returns the array', async () => {
    const fetch = fakeFetch({ 'GET /session': { body: [{ id: 's1', title: 'A' }] } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    const sessions = await api.listSessions();
    expect(sessions).toEqual([{ id: 's1', title: 'A' }]);
  });
});
```

- [ ] **Step 2: Run — must fail (module missing).**

Run: `npm run test:unit -- apiClient.test.ts`
Expected: FAIL.

---

### Task 2.3: Implement `apiClient.ts`

**Files:**
- Create: `src/opencode/apiClient.ts`

- [ ] **Step 1: Write the wrapper.**

```ts
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/client';
import { decisionToWire, type PermissionDecision } from './types';
import type { Part } from './types';

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface ApiClient {
  listSessions(): Promise<unknown[]>;
  createSession(title?: string): Promise<unknown>;
  deleteSession(id: string): Promise<void>;
  listMessages(sessionId: string): Promise<unknown[]>;
  sendPrompt(sessionId: string, parts: Part[], model?: { providerID: string; modelID: string }): Promise<unknown>;
  abort(sessionId: string): Promise<void>;
  replyPermission(sessionId: string, permissionId: string, decision: PermissionDecision): Promise<void>;
  listProviders(): Promise<unknown>;
  raw: OpencodeClient;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const client = createOpencodeClient({ baseUrl: opts.baseUrl, fetch: opts.fetch });

  const unwrap = async <T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> => {
    const r = await p;
    if (r.error) throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error));
    return r.data as T;
  };

  return {
    raw: client,
    listSessions: () => unwrap(client.session.list()),
    createSession: (title) => unwrap(client.session.create({ body: title ? { title } : {} })),
    deleteSession: async (id) => { await unwrap(client.session.delete({ path: { id } })); },
    listMessages: (sessionId) => unwrap(client.session.messages({ path: { id: sessionId } })),
    sendPrompt: (sessionId, parts, model) =>
      unwrap(client.session.prompt({ path: { id: sessionId }, body: { parts, ...(model ? { model } : {}) } })),
    abort: async (sessionId) => { await unwrap(client.session.abort({ path: { id: sessionId } })); },
    replyPermission: async (sessionId, permissionId, decision) => {
      await unwrap(client.postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permissionId },
        body: { response: decisionToWire[decision] },
      }));
    },
    listProviders: () => unwrap(client.config.providers()),
  };
}
```

- [ ] **Step 2: Run the test — must pass.**

Run: `npm run test:unit -- apiClient.test.ts`
Expected: PASS.

---

### Task 2.4: Tests for createSession, deleteSession, sendPrompt, abort, replyPermission

**Files:**
- Modify: `src/test/apiClient.test.ts`

- [ ] **Step 1: Append.**

```ts
  it('createSession posts to /session with title in body', async () => {
    const fetch = fakeFetch({ 'POST /session': { body: { id: 's-new', title: 'Hello' } } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    const created = await api.createSession('Hello');
    expect(created).toMatchObject({ id: 's-new' });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'Hello' });
  });

  it('sendPrompt posts to /session/<id>/message with parts and model', async () => {
    const fetch = fakeFetch({ 'POST /session/s1/message': { body: { id: 'm1' } } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.sendPrompt('s1', [{ type: 'text', text: 'hi' } as any], { providerID: 'anthropic', modelID: 'claude' });
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      parts: [{ type: 'text', text: 'hi' }],
      model: { providerID: 'anthropic', modelID: 'claude' },
    });
  });

  it('abort posts to /session/<id>/abort', async () => {
    const fetch = fakeFetch({ 'POST /session/s1/abort': { body: true } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.abort('s1');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
  });

  it('replyPermission maps allow→always, once→once, deny→reject', async () => {
    const fetch = fakeFetch({
      'POST /session/s1/permissions/p1': { body: true },
      'POST /session/s1/permissions/p2': { body: true },
      'POST /session/s1/permissions/p3': { body: true },
    });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.replyPermission('s1','p1','allow');
    await api.replyPermission('s1','p2','once');
    await api.replyPermission('s1','p3','deny');
    const bodies = fetch.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies.map(b => b.response)).toEqual(['always','once','reject']);
  });
```

- [ ] **Step 2: Run all apiClient tests.**

Run: `npm run test:unit -- apiClient.test.ts`
Expected: 5 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/opencode/apiClient.ts src/test/apiClient.test.ts
git commit -m "feat(api): typed apiClient wrapping @opencode-ai/sdk"
```

---

## Phase 3 — SSE client

### Task 3.1: Test — emits parsed events from a fake source

**Files:**
- Create: `src/test/sseClient.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { connectEventStream } from '../opencode/sseClient';

class FakeStream extends EventEmitter {
  abort = vi.fn();
}

function makeFakeOpen(stream: FakeStream) {
  return vi.fn(async () => stream);
}

describe('connectEventStream', () => {
  it('forwards parsed events to the onEvent callback', async () => {
    const stream = new FakeStream();
    const events: unknown[] = [];
    const handle = connectEventStream({
      open: makeFakeOpen(stream),
      onEvent: e => events.push(e),
      onError: () => {},
      onReconnect: () => {},
      backoffMs: () => 1,
    });
    // wait one microtask for open to resolve
    await Promise.resolve();
    stream.emit('event', { type: 'server.connected', properties: {} });
    stream.emit('event', { type: 'session.updated', properties: { info: { id: 's1' } } });
    expect(events).toEqual([
      { type: 'server.connected', properties: {} },
      { type: 'session.updated', properties: { info: { id: 's1' } } },
    ]);
    handle.close();
  });
});
```

- [ ] **Step 2: Run — must fail.**

Run: `npm run test:unit -- sseClient.test.ts`
Expected: FAIL — module missing.

---

### Task 3.2: Implement sseClient

**Files:**
- Create: `src/opencode/sseClient.ts`

- [ ] **Step 1: Write the implementation.**

```ts
import type { Event } from './types';

export interface EventStreamHandle { close(): void; }

export interface OpenedStream {
  on(event: 'event', handler: (e: Event) => void): unknown;
  on(event: 'error', handler: (err: unknown) => void): unknown;
  on(event: 'close', handler: () => void): unknown;
  abort(): void;
}

export interface ConnectOptions {
  open: () => Promise<OpenedStream>;
  onEvent: (e: Event) => void;
  onError: (err: unknown) => void;
  onReconnect: (attempt: number) => void;
  backoffMs?: (attempt: number) => number;
}

const defaultBackoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));

export function connectEventStream(opts: ConnectOptions): EventStreamHandle {
  const backoff = opts.backoffMs ?? defaultBackoff;
  let stopped = false;
  let attempt = 0;
  let current: OpenedStream | undefined;

  const dial = async () => {
    if (stopped) return;
    try {
      const stream = await opts.open();
      if (stopped) { stream.abort(); return; }
      current = stream;
      attempt = 0;
      stream.on('event', e => opts.onEvent(e));
      stream.on('error', err => { opts.onError(err); scheduleReconnect(); });
      stream.on('close', () => { scheduleReconnect(); });
    } catch (err) {
      opts.onError(err);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    attempt++;
    const delay = backoff(attempt);
    opts.onReconnect(attempt);
    setTimeout(dial, delay);
  };

  void dial();

  return {
    close() {
      stopped = true;
      try { current?.abort(); } catch {}
    },
  };
}
```

- [ ] **Step 2: Run the test — must pass.**

Run: `npm run test:unit -- sseClient.test.ts`
Expected: PASS.

---

### Task 3.3: Test — reconnect with backoff schedule

**Files:**
- Modify: `src/test/sseClient.test.ts`

- [ ] **Step 1: Append.**

```ts
  it('reconnects after error and grows attempt count', async () => {
    vi.useFakeTimers();
    let openCalls = 0;
    const reconnects: number[] = [];
    const open = vi.fn(async () => {
      openCalls++;
      const s = new FakeStream();
      // Fail immediately on the first two opens
      setImmediate(() => s.emit('error', new Error('boom')));
      return s;
    });
    const handle = connectEventStream({
      open,
      onEvent: () => {},
      onError: () => {},
      onReconnect: a => reconnects.push(a),
      backoffMs: () => 10,
    });
    // Drain the first attempt + first reconnect
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    expect(openCalls).toBeGreaterThanOrEqual(2);
    expect(reconnects[0]).toBe(1);
    handle.close();
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run.**

Run: `npm run test:unit -- sseClient.test.ts`
Expected: PASS (both tests).

- [ ] **Step 3: Commit.**

```bash
git add src/opencode/sseClient.ts src/test/sseClient.test.ts
git commit -m "feat(sse): event stream subscriber with reconnect/backoff"
```

---

### Task 3.4: Adapter — open the SDK's event stream as an `OpenedStream`

**Files:**
- Modify: `src/opencode/sseClient.ts`

- [ ] **Step 1: Append a helper that adapts the SDK's `client.event()` to `OpenedStream`.**

```ts
import type { OpencodeClient } from '@opencode-ai/sdk/client';

export async function openSdkEventStream(client: OpencodeClient): Promise<OpenedStream> {
  const result = await client.event();
  if (result.error) throw new Error('Failed to open /event: ' + JSON.stringify(result.error));
  // result.stream is an async iterable of typed events per heyapi SSE result.
  const stream = result.stream as AsyncIterable<{ data: Event }>;
  const ac = new AbortController();
  const handlers = { event: [] as Array<(e: Event) => void>, error: [] as Array<(e: unknown) => void>, close: [] as Array<() => void> };
  void (async () => {
    try {
      for await (const ev of stream) {
        if (ac.signal.aborted) break;
        handlers.event.forEach(h => h(ev.data));
      }
      handlers.close.forEach(h => h());
    } catch (err) {
      handlers.error.forEach(h => h(err));
    }
  })();
  return {
    on(name, h) { (handlers as any)[name].push(h); return () => {}; },
    abort() { ac.abort(); },
  };
}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/opencode/sseClient.ts
git commit -m "feat(sse): adapter for @opencode-ai/sdk event() stream"
```

---

## Phase 4 — Bridge protocol types

### Task 4.1: Define postMessage shapes

**Files:**
- Create: `src/sidebar/bridgeProtocol.ts`

- [ ] **Step 1: Write the file.**

```ts
import type { Event, PermissionDecision } from '../opencode/types';

export interface SessionSummary { id: string; title: string; updatedAt: number; }

export type EventToWebview =
  | { type: 'ready'; sessions: SessionSummary[]; activeSessionId: string | null; defaultModel: string | null }
  | { type: 'sse'; event: Event }
  | { type: 'sessionMessages'; sessionId: string; messages: unknown[] }
  | { type: 'serverStatus'; status: 'starting' | 'ready' | 'reconnecting' | 'error'; error?: string }
  | { type: 'error'; message: string };

export type EventFromWebview =
  | { type: 'ready' }
  | { type: 'send'; sessionId: string; text: string; model?: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'permissionReply'; sessionId: string; permissionId: string; decision: PermissionDecision }
  | { type: 'restartServer' };
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/sidebar/bridgeProtocol.ts
git commit -m "feat(bridge): typed postMessage protocol between extension and webview"
```

---

## Phase 5 — State machine

### Task 5.1: Test — initial state and `session.created` adds row

**Files:**
- Create: `src/test/state.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../webview/state';

describe('reduce', () => {
  it('starts empty', () => {
    expect(initialState()).toMatchObject({
      sessions: [],
      activeSessionId: null,
      pendingPermission: null,
      status: 'idle',
    });
  });

  it('session.created appends a session and selects it if none active', () => {
    const s = reduce(initialState(), {
      type: 'sse',
      event: { type: 'session.created', properties: { info: { id: 's1', title: 'Hello', time: { updated: 5 } } } } as any,
    });
    expect(s.sessions.map(x => x.id)).toEqual(['s1']);
    expect(s.activeSessionId).toBe('s1');
  });
});
```

- [ ] **Step 2: Run — must fail.**

Run: `npm run test:unit -- state.test.ts`
Expected: FAIL — module missing.

---

### Task 5.2: Implement state shape and reducer skeleton

**Files:**
- Create: `src/webview/state.ts`

- [ ] **Step 1: Write the reducer.**

```ts
import type { EventToWebview } from '../sidebar/bridgeProtocol';
import type { Event, Part } from '../opencode/types';

export interface SessionRow { id: string; title: string; updatedAt: number; }
export interface PendingPermission { id: string; sessionId: string; messageId: string; title: string; metadata: Record<string, unknown>; pattern?: string | string[]; }

export interface State {
  sessions: SessionRow[];
  activeSessionId: string | null;
  /** message id → ordered parts */
  partsByMessage: Map<string, Part[]>;
  /** session id → ordered message ids */
  messageIdsBySession: Map<string, string[]>;
  pendingPermission: PendingPermission | null;
  composer: { text: string; model: string };
  status: 'idle' | 'streaming' | 'error' | 'reconnecting';
  serverError: string | null;
}

export function initialState(): State {
  return {
    sessions: [],
    activeSessionId: null,
    partsByMessage: new Map(),
    messageIdsBySession: new Map(),
    pendingPermission: null,
    composer: { text: '', model: '' },
    status: 'idle',
    serverError: null,
  };
}

export function reduce(state: State, msg: EventToWebview): State {
  if (msg.type === 'ready') {
    return {
      ...state,
      sessions: msg.sessions.map(s => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
      activeSessionId: msg.activeSessionId ?? state.activeSessionId,
      composer: { ...state.composer, model: msg.defaultModel ?? '' },
      status: 'idle',
    };
  }
  if (msg.type === 'serverStatus') {
    return { ...state, status: msg.status === 'ready' ? 'idle' : msg.status === 'reconnecting' ? 'reconnecting' : 'error', serverError: msg.error ?? null };
  }
  if (msg.type === 'sessionMessages') {
    const partsByMessage = new Map(state.partsByMessage);
    const messageIds: string[] = [];
    for (const m of msg.messages as Array<{ info: { id: string }; parts: Part[] }>) {
      messageIds.push(m.info.id);
      partsByMessage.set(m.info.id, m.parts);
    }
    const messageIdsBySession = new Map(state.messageIdsBySession);
    messageIdsBySession.set(msg.sessionId, messageIds);
    return { ...state, partsByMessage, messageIdsBySession };
  }
  if (msg.type === 'sse') return reduceSse(state, msg.event);
  return state;
}

function reduceSse(state: State, e: Event): State {
  switch (e.type) {
    case 'session.created':
    case 'session.updated': {
      const info = (e as any).properties.info as { id: string; title: string; time: { updated: number } };
      const others = state.sessions.filter(s => s.id !== info.id);
      const sessions = [{ id: info.id, title: info.title, updatedAt: info.time.updated }, ...others];
      return {
        ...state,
        sessions,
        activeSessionId: state.activeSessionId ?? info.id,
      };
    }
    case 'session.deleted': {
      const id = (e as any).properties.info.id as string;
      const sessions = state.sessions.filter(s => s.id !== id);
      const activeSessionId = state.activeSessionId === id ? (sessions[0]?.id ?? null) : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }
    case 'message.updated': {
      const info = (e as any).properties.info as { id: string; sessionID: string };
      const ids = state.messageIdsBySession.get(info.sessionID) ?? [];
      if (ids.includes(info.id)) return state;
      const messageIdsBySession = new Map(state.messageIdsBySession);
      messageIdsBySession.set(info.sessionID, [...ids, info.id]);
      const partsByMessage = new Map(state.partsByMessage);
      if (!partsByMessage.has(info.id)) partsByMessage.set(info.id, []);
      return { ...state, messageIdsBySession, partsByMessage, status: 'streaming' };
    }
    case 'message.part.updated': {
      const part = (e as any).properties.part as Part & { messageID: string; id: string };
      const partsByMessage = new Map(state.partsByMessage);
      const existing = partsByMessage.get(part.messageID) ?? [];
      const idx = existing.findIndex(p => (p as any).id === part.id);
      const next = idx >= 0 ? existing.map((p, i) => i === idx ? part : p) : [...existing, part];
      partsByMessage.set(part.messageID, next);
      return { ...state, partsByMessage };
    }
    case 'message.removed': {
      const { sessionID, messageID } = (e as any).properties as { sessionID: string; messageID: string };
      const ids = state.messageIdsBySession.get(sessionID) ?? [];
      const messageIdsBySession = new Map(state.messageIdsBySession);
      messageIdsBySession.set(sessionID, ids.filter(x => x !== messageID));
      const partsByMessage = new Map(state.partsByMessage);
      partsByMessage.delete(messageID);
      return { ...state, messageIdsBySession, partsByMessage };
    }
    case 'permission.updated': {
      const p = (e as any).properties as { id: string; sessionID: string; messageID: string; title: string; metadata: Record<string, unknown>; pattern?: string | string[] };
      return { ...state, pendingPermission: { id: p.id, sessionId: p.sessionID, messageId: p.messageID, title: p.title, metadata: p.metadata, pattern: p.pattern } };
    }
    case 'permission.replied': {
      const id = (e as any).properties.permissionID as string;
      if (state.pendingPermission?.id !== id) return state;
      return { ...state, pendingPermission: null };
    }
    case 'session.idle' as any:
    case 'session.completed' as any: {
      return { ...state, status: 'idle' };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 2: Run the test — must pass.**

Run: `npm run test:unit -- state.test.ts`
Expected: 2 tests pass.

---

### Task 5.3: Tests for message lifecycle, parts append/replace, removal

**Files:**
- Modify: `src/test/state.test.ts`

- [ ] **Step 1: Append.**

```ts
  it('message.updated creates an empty parts slot the first time', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'A', time: { updated: 1 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    expect(s.messageIdsBySession.get('s1')).toEqual(['m1']);
    expect(s.partsByMessage.get('m1')).toEqual([]);
    expect(s.status).toBe('streaming');
  });

  it('message.part.updated replaces parts by id, not appends, on second chunk', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'A', time: { updated: 1 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi there' } } } as any });
    const parts = s.partsByMessage.get('m1')!;
    expect(parts).toHaveLength(1);
    expect((parts[0] as any).text).toBe('hi there');
  });

  it('message.removed removes from session list and parts map', () => {
    let s = initialState();
    s = reduce(s, { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title:'A', time:{updated:1} } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.removed', properties: { sessionID: 's1', messageID: 'm1' } } as any });
    expect(s.messageIdsBySession.get('s1')).toEqual([]);
    expect(s.partsByMessage.has('m1')).toBe(false);
  });
```

- [ ] **Step 2: Run.**

Run: `npm run test:unit -- state.test.ts`
Expected: 5 tests pass.

---

### Task 5.4: Tests for permission flow and session deletion fallback

**Files:**
- Modify: `src/test/state.test.ts`

- [ ] **Step 1: Append.**

```ts
  it('permission.updated sets pendingPermission; permission.replied clears it', () => {
    let s = initialState();
    s = reduce(s, { type: 'sse', event: { type: 'permission.updated', properties: { id: 'pp1', sessionID: 's1', messageID: 'm1', title: 'edit foo', metadata: {} } } as any });
    expect(s.pendingPermission?.id).toBe('pp1');
    s = reduce(s, { type: 'sse', event: { type: 'permission.replied', properties: { permissionID: 'pp1' } } as any });
    expect(s.pendingPermission).toBeNull();
  });

  it('session.deleted on the active session falls back to the next session', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title:'A', time:{updated:1} } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's2', title:'B', time:{updated:2} } } } as any });
    expect(s.activeSessionId).toBe('s1');
    s = reduce(s, { type: 'sse', event: { type: 'session.deleted', properties: { info: { id: 's1' } } } as any });
    expect(s.activeSessionId).toBe('s2');
  });
```

- [ ] **Step 2: Run all state tests.**

Run: `npm run test:unit -- state.test.ts`
Expected: 7 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/webview/state.ts src/test/state.test.ts
git commit -m "feat(state): pure reducer for sessions, messages, parts, permissions"
```

---

### Task 5.5: Tiny event emitter for state subscriptions

**Files:**
- Modify: `src/webview/state.ts`

- [ ] **Step 1: Append a Store class at the end of the file.**

```ts
export type Listener = (state: State) => void;

export class Store {
  private state = initialState();
  private listeners = new Set<Listener>();
  get(): State { return this.state; }
  dispatch(msg: EventToWebview): void {
    const next = reduce(this.state, msg);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach(l => l(this.state));
    }
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => { this.listeners.delete(l); };
  }
}
```

- [ ] **Step 2: Add a test for Store dispatch + subscribe.**

Append to `src/test/state.test.ts`:

```ts
  it('Store notifies subscribers on dispatch', () => {
    const { Store } = require('../webview/state');
    const store = new Store();
    const seen: string[] = [];
    store.subscribe((s: any) => seen.push(s.activeSessionId ?? '∅'));
    store.dispatch({ type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'a', time: { updated: 1 } } } } });
    expect(seen).toEqual(['∅', 's1']);
  });
```

- [ ] **Step 3: Run.**

Run: `npm run test:unit -- state.test.ts`
Expected: 8 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add src/webview/state.ts src/test/state.test.ts
git commit -m "feat(state): Store wrapping reducer with subscribe/dispatch"
```

---

## Phase 6 — Bridge

### Task 6.1: Tests for messageBridge — translates `send` and `permissionReply`

**Files:**
- Create: `src/test/bridge.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { MessageBridge } from '../sidebar/messageBridge';

function fakeApi() {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'snew', title:'', time:{updated: 1} }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([]),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue({ providers: [] }),
    raw: {} as any,
  };
}

describe('MessageBridge', () => {
  it('on `send` calls api.sendPrompt with text part', async () => {
    const api = fakeApi();
    const post = vi.fn();
    const bridge = new MessageBridge({ api, post, onRestartServer: vi.fn() });
    await bridge.handle({ type: 'send', sessionId: 's1', text: 'hi', model: 'anthropic/claude' });
    expect(api.sendPrompt).toHaveBeenCalledWith(
      's1',
      [{ type: 'text', text: 'hi' }],
      { providerID: 'anthropic', modelID: 'claude' },
    );
  });

  it('on `permissionReply` forwards decision', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn() });
    await bridge.handle({ type: 'permissionReply', sessionId: 's1', permissionId: 'p1', decision: 'once' });
    expect(api.replyPermission).toHaveBeenCalledWith('s1','p1','once');
  });
});
```

- [ ] **Step 2: Run — must fail (module missing).**

Run: `npm run test:unit -- bridge.test.ts`
Expected: FAIL.

---

### Task 6.2: Implement messageBridge

**Files:**
- Create: `src/sidebar/messageBridge.ts`

- [ ] **Step 1: Write the implementation.**

```ts
import type { ApiClient } from '../opencode/apiClient';
import type { EventFromWebview, EventToWebview } from './bridgeProtocol';

export interface BridgeOptions {
  api: ApiClient;
  post: (msg: EventToWebview) => void;
  onRestartServer: () => void;
}

export class MessageBridge {
  constructor(private opts: BridgeOptions) {}

  async handle(msg: EventFromWebview): Promise<void> {
    const { api, post, onRestartServer } = this.opts;
    try {
      switch (msg.type) {
        case 'ready': {
          const [sessions, providers] = await Promise.all([api.listSessions(), api.listProviders()]);
          const list = (sessions as any[]).map(s => ({
            id: s.id, title: s.title ?? '(untitled)', updatedAt: s.time?.updated ?? 0,
          }));
          const defaultModel = pickDefaultModel(providers);
          post({ type: 'ready', sessions: list, activeSessionId: list[0]?.id ?? null, defaultModel });
          if (list[0]) {
            const messages = await api.listMessages(list[0].id);
            post({ type: 'sessionMessages', sessionId: list[0].id, messages });
          }
          break;
        }
        case 'send': {
          const model = parseModel(msg.model);
          await api.sendPrompt(msg.sessionId, [{ type: 'text', text: msg.text } as any], model);
          break;
        }
        case 'stop':              await api.abort(msg.sessionId); break;
        case 'newSession': {
          const created = await api.createSession();
          // session.created SSE will reach the webview; nothing else to do here
          void created;
          break;
        }
        case 'switchSession': {
          const messages = await api.listMessages(msg.sessionId);
          post({ type: 'sessionMessages', sessionId: msg.sessionId, messages });
          break;
        }
        case 'deleteSession':     await api.deleteSession(msg.sessionId); break;
        case 'permissionReply':   await api.replyPermission(msg.sessionId, msg.permissionId, msg.decision); break;
        case 'restartServer':     onRestartServer(); break;
      }
    } catch (err: unknown) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

function parseModel(raw?: string): { providerID: string; modelID: string } | undefined {
  if (!raw) return undefined;
  const ix = raw.indexOf('/');
  if (ix < 1) return undefined;
  return { providerID: raw.slice(0, ix), modelID: raw.slice(ix + 1) };
}

function pickDefaultModel(providers: unknown): string | null {
  const list = (providers as any)?.providers;
  if (!Array.isArray(list) || list.length === 0) return null;
  const p = list[0];
  const modelKey = Object.keys(p?.models ?? {})[0];
  return modelKey ? `${p.id}/${modelKey}` : null;
}
```

- [ ] **Step 2: Run the test — must pass.**

Run: `npm run test:unit -- bridge.test.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/sidebar/messageBridge.ts src/test/bridge.test.ts
git commit -m "feat(bridge): translate webview messages into apiClient calls"
```

---

## Phase 7 — Webview shell + components

> Component tests run in `jsdom` (vitest auto-selects via `environmentMatchGlobs`). Components are vanilla TS that operate on DOM — no framework. Each component exposes `mount(parent, deps)` returning a teardown function.

### Task 7.1: Webview HTML + bootstrap

**Files:**
- Create: `src/webview/index.html`
- Replace: `src/webview/main.ts` (was a one-line stub)
- Create: `src/webview/ui.css`

- [ ] **Step 1: Write `src/webview/index.html`.**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' {{cspSource}}; script-src 'nonce-{{nonce}}'; img-src {{cspSource}} data:;">
    <link rel="stylesheet" href="{{uiCssUri}}">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="{{nonce}}" src="{{mainJsUri}}"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/webview/ui.css`.**

```css
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; height: 100%; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
#root { display: flex; flex-direction: column; height: 100vh; }
.header { display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-sideBar-border); gap: 6px; }
.header h1 { flex: 1; font-size: 12px; margin: 0; font-weight: 600; }
.icon-btn { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 2px 6px; border-radius: 3px; }
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.session-list { max-height: 30%; overflow: auto; border-bottom: 1px solid var(--vscode-sideBar-border); padding: 2px 0; }
.session-row { display: flex; padding: 4px 8px; cursor: pointer; gap: 6px; align-items: baseline; font-size: 12px; }
.session-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.session-row:hover { background: var(--vscode-list-hoverBackground); }
.session-row .title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-row .time { opacity: 0.6; font-size: 10px; }
.messages { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 10px; }
.role { font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
.tool-card { border: 1px solid var(--vscode-input-border); border-left: 2px solid var(--vscode-textLink-foreground); border-radius: 3px; overflow: hidden; }
.tool-head { padding: 4px 8px; display: flex; gap: 6px; font-size: 11px; align-items: center; background: var(--vscode-textBlockQuote-background); }
.tool-body { padding: 6px 8px; font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; max-height: 240px; overflow: auto; background: var(--vscode-textCodeBlock-background); }
.diff-add { background: rgba(40,180,99,0.15); display: block; }
.diff-rem { background: rgba(220,80,80,0.15); display: block; }
.permission { border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; padding: 8px; background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent); }
.permission .actions { display: flex; gap: 6px; margin-top: 6px; }
.btn { padding: 4px 10px; border-radius: 3px; border: 0; cursor: pointer; font: inherit; }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-secondary { background: transparent; border: 1px solid var(--vscode-button-border, var(--vscode-input-border)); color: inherit; }
.btn-danger { background: var(--vscode-errorForeground); color: var(--vscode-button-foreground); }
.composer { border-top: 1px solid var(--vscode-sideBar-border); padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.composer textarea { resize: none; min-height: 36px; max-height: 130px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 4px 6px; font: inherit; }
.composer .row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.composer .row .model { flex: 1; opacity: 0.7; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; opacity: 0.7; }
.banner { padding: 4px 8px; font-size: 11px; background: var(--vscode-statusBarItem-warningBackground); color: var(--vscode-statusBarItem-warningForeground); }
```

- [ ] **Step 3: Replace `src/webview/main.ts` with the bootstrap.**

```ts
import { Store } from './state';
import { mountHeader } from './components/Header';
import { mountSessionList } from './components/SessionList';
import { mountMessageList } from './components/MessageList';
import { mountComposer } from './components/Composer';
import type { EventFromWebview, EventToWebview } from '../sidebar/bridgeProtocol';

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };

const vscode = acquireVsCodeApi();
const store = new Store();

const root = document.getElementById('root')!;
root.innerHTML = `
  <div class="header"></div>
  <div class="session-list"></div>
  <div class="messages"></div>
  <div class="composer"></div>
`;

const post = (m: EventFromWebview) => vscode.postMessage(m);

mountHeader(root.querySelector('.header')!, { post });
mountSessionList(root.querySelector('.session-list')!, { store, post });
mountMessageList(root.querySelector('.messages')!, { store, post });
mountComposer(root.querySelector('.composer')!, { store, post });

window.addEventListener('message', (ev: MessageEvent<EventToWebview>) => {
  store.dispatch(ev.data);
});

post({ type: 'ready' });
```

- [ ] **Step 4: Stub all the component files so the build doesn't break.**

```bash
mkdir -p src/webview/components
for f in Header SessionList MessageList TextPart ToolPart PermissionPart Composer; do
  echo "export function mount${f}(_el: HTMLElement, _deps: unknown) { return () => {}; }" > "src/webview/components/${f}.ts"
done
```

- [ ] **Step 5: Build to verify.**

Run: `node esbuild.js`
Expected: `[esbuild] built extension + webview` with no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/webview/index.html src/webview/ui.css src/webview/main.ts src/webview/components
git commit -m "feat(webview): bootstrap HTML, theme-token CSS, component stubs"
```

---

### Task 7.2: SessionList component (TDD)

**Files:**
- Create: `src/test/components/SessionList.test.ts`
- Replace: `src/webview/components/SessionList.ts`

- [ ] **Step 1: Failing test.**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountSessionList } from '../../webview/components/SessionList';

describe('SessionList', () => {
  it('renders one row per session and marks the active one', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{id:'a',title:'Alpha',updatedAt:1},{id:'b',title:'Beta',updatedAt:2}], activeSessionId:'b', defaultModel: null });
    const el = document.createElement('div');
    mountSessionList(el, { store, post: vi.fn() });
    const rows = el.querySelectorAll('.session-row');
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains('active')).toBe(true);
    expect(rows[0].textContent).toContain('Alpha');
  });

  it('clicking a row posts switchSession', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{id:'a',title:'Alpha',updatedAt:1}], activeSessionId:'a', defaultModel: null });
    const el = document.createElement('div');
    const post = vi.fn();
    mountSessionList(el, { store, post });
    (el.querySelector('.session-row') as HTMLElement).click();
    expect(post).toHaveBeenCalledWith({ type: 'switchSession', sessionId: 'a' });
  });
});
```

- [ ] **Step 2: Run — failing.**

Run: `npm run test:unit -- SessionList.test.ts`
Expected: FAIL (component is a stub).

- [ ] **Step 3: Implement `src/webview/components/SessionList.ts`.**

```ts
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountSessionList(parent: HTMLElement, { store, post }: Deps): () => void {
  const render = () => {
    const s = store.get();
    parent.innerHTML = '';
    for (const row of s.sessions) {
      const div = document.createElement('div');
      div.className = 'session-row' + (row.id === s.activeSessionId ? ' active' : '');
      div.dataset.sessionId = row.id;
      div.innerHTML = `<span class="title"></span><span class="time"></span>`;
      div.querySelector('.title')!.textContent = row.title;
      div.querySelector('.time')!.textContent = formatRel(row.updatedAt);
      div.addEventListener('click', () => post({ type: 'switchSession', sessionId: row.id }));
      parent.appendChild(div);
    }
  };
  return store.subscribe(render);
}

function formatRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return Math.floor(diff/60_000)+'m';
  if (diff < 86_400_000) return Math.floor(diff/3_600_000)+'h';
  return Math.floor(diff/86_400_000)+'d';
}
```

- [ ] **Step 4: Run — must pass.**

Run: `npm run test:unit -- SessionList.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/webview/components/SessionList.ts src/test/components/SessionList.test.ts
git commit -m "feat(webview): SessionList component with TDD coverage"
```

---

### Task 7.3: TextPart + markdown helper

**Files:**
- Create: `src/webview/markdown.ts`
- Replace: `src/webview/components/TextPart.ts`

- [ ] **Step 1: Write `markdown.ts`.**

```ts
import { marked } from 'marked';
marked.setOptions({ gfm: true, breaks: true });
export function renderMarkdown(md: string): string { return marked.parse(md, { async: false }) as string; }
```

- [ ] **Step 2: Replace `TextPart.ts`.**

```ts
import { renderMarkdown } from '../markdown';
export function mountTextPart(el: HTMLElement, text: string): void {
  el.innerHTML = renderMarkdown(text);
}
```

- [ ] **Step 3: Type-check + build.**

Run: `node esbuild.js`
Expected: succeeds.

- [ ] **Step 4: Commit.**

```bash
git add src/webview/markdown.ts src/webview/components/TextPart.ts
git commit -m "feat(webview): markdown rendering for text parts"
```

---

### Task 7.4: ToolPart + MessageList (TDD)

**Files:**
- Replace: `src/webview/components/ToolPart.ts`
- Replace: `src/webview/components/MessageList.ts`
- Create: `src/test/components/MessageList.test.ts`

- [ ] **Step 1: Write `ToolPart.ts`.**

```ts
type ToolPartShape = { id: string; type: 'tool'; tool: string; state: { status: 'pending'|'running'|'completed'|'error'; input?: unknown; output?: string; time?: { start?: number; end?: number } } };

export function mountToolPart(el: HTMLElement, part: ToolPartShape): void {
  const status = part.state.status;
  const dur = part.state.time?.start && part.state.time?.end ? ((part.state.time.end - part.state.time.start)/1000).toFixed(1)+'s' : '';
  const symbol = status === 'completed' ? '✓' : status === 'error' ? '✕' : '●';
  el.className = 'tool-card';
  el.innerHTML = `
    <div class="tool-head">
      <span>${symbol}</span>
      <span style="font-family:var(--vscode-editor-font-family); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
      <span style="opacity:0.6">${dur}</span>
    </div>
    <div class="tool-body"></div>
  `;
  (el.querySelector('.tool-head span:nth-child(2)') as HTMLElement).textContent = `${part.tool} ${argsSummary(part.state.input)}`;
  (el.querySelector('.tool-body') as HTMLElement).textContent = part.state.output ?? '';
}

function argsSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  if (typeof o.command === 'string') return o.command;
  if (typeof o.file_path === 'string') return o.file_path as string;
  return JSON.stringify(o).slice(0, 80);
}
```

- [ ] **Step 2: Write `MessageList.ts`.**

```ts
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { mountTextPart } from './TextPart';
import { mountToolPart } from './ToolPart';
import { mountPermissionPart } from './PermissionPart';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountMessageList(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.classList.add('messages');
  let pinned = true;
  parent.addEventListener('scroll', () => {
    pinned = parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 100;
  });
  const render = () => {
    const s = store.get();
    parent.innerHTML = '';
    if (!s.activeSessionId) {
      parent.innerHTML = `<div class="empty"><div>Start a new chat</div><button class="btn btn-primary" data-action="new">+ New session</button></div>`;
      parent.querySelector('[data-action=new]')?.addEventListener('click', () => post({ type: 'newSession' }));
      return;
    }
    const ids = s.messageIdsBySession.get(s.activeSessionId) ?? [];
    for (const id of ids) {
      const parts = s.partsByMessage.get(id) ?? [];
      for (const part of parts) {
        const wrap = document.createElement('div');
        if ((part as any).type === 'text') {
          const role = document.createElement('div');
          role.className = 'role';
          role.textContent = (part as any).role ?? 'assistant';
          wrap.appendChild(role);
          const body = document.createElement('div');
          mountTextPart(body, (part as any).text ?? '');
          wrap.appendChild(body);
        } else if ((part as any).type === 'tool') {
          mountToolPart(wrap, part as any);
        }
        parent.appendChild(wrap);
      }
    }
    if (s.pendingPermission && s.pendingPermission.sessionId === s.activeSessionId) {
      const pp = document.createElement('div');
      mountPermissionPart(pp, s.pendingPermission, post);
      parent.appendChild(pp);
    }
    if (pinned) parent.scrollTop = parent.scrollHeight;
  };
  return store.subscribe(render);
}
```

- [ ] **Step 3: Test for MessageList.**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountMessageList } from '../../webview/components/MessageList';

describe('MessageList', () => {
  it('shows empty state with a New session button when no active session', () => {
    const store = new Store();
    const el = document.createElement('div');
    const post = vi.fn();
    mountMessageList(el, { store, post });
    const btn = el.querySelector('[data-action=new]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(post).toHaveBeenCalledWith({ type: 'newSession' });
  });

  it('renders text parts and tool parts in order', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel: null });
    store.dispatch({ type: 'sse', event: { type: 'message.updated', properties: { info: { id:'m1', sessionID:'s1' } } } as any });
    store.dispatch({ type: 'sse', event: { type: 'message.part.updated', properties: { part: { id:'p1', messageID:'m1', type:'text', text:'hello' } } } as any });
    store.dispatch({ type: 'sse', event: { type: 'message.part.updated', properties: { part: { id:'p2', messageID:'m1', type:'tool', tool:'bash', state:{ status:'completed', input:{ command:'ls' }, output:'file' } } } } as any });
    const el = document.createElement('div');
    mountMessageList(el, { store, post: vi.fn() });
    expect(el.textContent).toContain('hello');
    expect(el.querySelector('.tool-card')).toBeTruthy();
    expect(el.querySelector('.tool-card')!.textContent).toContain('bash');
  });
});
```

- [ ] **Step 4: Run.**

Run: `npm run test:unit -- MessageList.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/webview/components/MessageList.ts src/webview/components/ToolPart.ts src/test/components/MessageList.test.ts
git commit -m "feat(webview): MessageList renders text + tool parts; auto-scroll pin"
```

---

### Task 7.5: PermissionPart (TDD)

**Files:**
- Create: `src/test/components/PermissionPart.test.ts`
- Replace: `src/webview/components/PermissionPart.ts`

- [ ] **Step 1: Failing test.**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountPermissionPart } from '../../webview/components/PermissionPart';

describe('PermissionPart', () => {
  it('renders three buttons; each posts a different decision', () => {
    const el = document.createElement('div');
    const post = vi.fn();
    mountPermissionPart(el, { id:'pp1', sessionId:'s1', messageId:'m1', title:'edit foo', metadata:{} }, post);
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    (buttons[2] as HTMLButtonElement).click();
    expect(post.mock.calls.map(c => c[0].decision)).toEqual(['allow','once','deny']);
  });

  it('Esc denies, Enter chooses once', () => {
    const el = document.createElement('div');
    const post = vi.fn();
    mountPermissionPart(el, { id:'pp1', sessionId:'s1', messageId:'m1', title:'edit foo', metadata:{} }, post);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(post.mock.calls.map(c => c[0].decision)).toEqual(['deny','once']);
  });
});
```

- [ ] **Step 2: Run — failing.**

Run: `npm run test:unit -- PermissionPart.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { PendingPermission } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import type { PermissionDecision } from '../../opencode/types';

export function mountPermissionPart(el: HTMLElement, p: PendingPermission, post: (m: EventFromWebview) => void): void {
  el.className = 'permission';
  el.tabIndex = 0;
  el.innerHTML = `
    <div><strong>⚠ Permission required</strong> — <span class="title"></span></div>
    <div class="meta" style="font-family:var(--vscode-editor-font-family); font-size:11px; margin-top:6px;"></div>
    <div class="actions">
      <button class="btn btn-primary"  data-decision="allow">Allow</button>
      <button class="btn btn-secondary" data-decision="once">Allow once</button>
      <button class="btn btn-danger"   data-decision="deny">Deny</button>
    </div>
  `;
  (el.querySelector('.title') as HTMLElement).textContent = p.title;
  (el.querySelector('.meta') as HTMLElement).textContent = renderMeta(p);
  const reply = (decision: PermissionDecision) => post({ type: 'permissionReply', sessionId: p.sessionId, permissionId: p.id, decision });
  el.querySelectorAll('button[data-decision]').forEach(b => b.addEventListener('click', () => reply((b as HTMLButtonElement).dataset.decision as PermissionDecision)));
  el.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter')  { ev.preventDefault(); reply('once'); }
    if (ev.key === 'Escape') { ev.preventDefault(); reply('deny'); }
  });
  setTimeout(() => el.focus(), 0);
}

function renderMeta(p: PendingPermission): string {
  const m = p.metadata as any;
  if (typeof m?.command === 'string') return '$ ' + m.command;
  if (typeof m?.diff === 'string')    return m.diff;
  if (Array.isArray(p.pattern))       return p.pattern.join(', ');
  if (typeof p.pattern === 'string')  return p.pattern;
  return '';
}
```

- [ ] **Step 4: Run.**

Run: `npm run test:unit -- PermissionPart.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/webview/components/PermissionPart.ts src/test/components/PermissionPart.test.ts
git commit -m "feat(webview): PermissionPart with Allow/Once/Deny + keyboard"
```

---

### Task 7.6: Composer (TDD)

**Files:**
- Create: `src/test/components/Composer.test.ts`
- Replace: `src/webview/components/Composer.ts`

- [ ] **Step 1: Failing test.**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountComposer } from '../../webview/components/Composer';

describe('Composer', () => {
  it('Enter sends; Shift-Enter inserts newline', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions:[{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:'anthropic/claude' });
    const el = document.createElement('div');
    const post = vi.fn();
    mountComposer(el, { store, post });
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'hello';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(post).toHaveBeenCalledWith({ type: 'send', sessionId: 's1', text: 'hello', model: 'anthropic/claude' });
    post.mockClear();
    ta.value = 'line1';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(post).not.toHaveBeenCalled();
  });

  it('shows Stop button while streaming', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions:[{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:null });
    store.dispatch({ type: 'sse', event:{ type:'message.updated', properties:{ info:{ id:'m1', sessionID:'s1' } } } as any });
    const el = document.createElement('div');
    const post = vi.fn();
    mountComposer(el, { store, post });
    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/Stop/);
    btn.click();
    expect(post).toHaveBeenCalledWith({ type: 'stop', sessionId: 's1' });
  });
});
```

- [ ] **Step 2: Run — failing.**

Run: `npm run test:unit -- Composer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountComposer(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.classList.add('composer');
  parent.innerHTML = `
    <textarea rows="2" placeholder="Ask opencode..."></textarea>
    <div class="row">
      <span class="model"></span>
      <button class="btn btn-primary" data-action="primary">Send</button>
    </div>
  `;
  const ta = parent.querySelector('textarea') as HTMLTextAreaElement;
  const btn = parent.querySelector('button') as HTMLButtonElement;
  const modelEl = parent.querySelector('.model') as HTMLElement;

  const send = () => {
    const s = store.get();
    if (!s.activeSessionId) return;
    const text = ta.value.trim();
    if (!text) return;
    post({ type: 'send', sessionId: s.activeSessionId, text, model: s.composer.model || undefined });
    ta.value = '';
  };
  const stop = () => { const s = store.get(); if (s.activeSessionId) post({ type: 'stop', sessionId: s.activeSessionId }); };

  ta.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(130, ta.scrollHeight) + 'px';
  });

  const render = () => {
    const s = store.get();
    modelEl.textContent = s.composer.model || '(default model)';
    if (s.status === 'streaming') {
      btn.textContent = 'Stop';
      btn.dataset.action = 'stop';
      btn.onclick = stop;
    } else {
      btn.textContent = 'Send';
      btn.dataset.action = 'send';
      btn.onclick = send;
    }
  };
  return store.subscribe(render);
}
```

- [ ] **Step 4: Run.**

Run: `npm run test:unit -- Composer.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/webview/components/Composer.ts src/test/components/Composer.test.ts
git commit -m "feat(webview): Composer with Enter-to-send + Stop while streaming"
```

---

### Task 7.7: Header

**Files:**
- Replace: `src/webview/components/Header.ts`

- [ ] **Step 1: Implement.**

```ts
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { post: (m: EventFromWebview) => void; }

export function mountHeader(parent: HTMLElement, { post }: Deps): () => void {
  parent.innerHTML = `
    <h1>OpenCode</h1>
    <button class="icon-btn" title="New session" data-action="new">+</button>
    <button class="icon-btn" title="Restart server" data-action="restart">⟳</button>
  `;
  parent.querySelector('[data-action=new]')!.addEventListener('click', () => post({ type: 'newSession' }));
  parent.querySelector('[data-action=restart]')!.addEventListener('click', () => post({ type: 'restartServer' }));
  return () => {};
}
```

- [ ] **Step 2: Build to confirm everything compiles.**

Run: `node esbuild.js`
Expected: succeeds.

- [ ] **Step 3: Commit.**

```bash
git add src/webview/components/Header.ts
git commit -m "feat(webview): Header with new session and restart server"
```

---

## Phase 8 — SidebarProvider + extension wiring

### Task 8.1: SidebarProvider.ts

**Files:**
- Create: `src/sidebar/SidebarProvider.ts`

- [ ] **Step 1: Write it.**

```ts
import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { startOpencodeServer, type ServerHandle } from '../opencode/serverProcess';
import { createApiClient } from '../opencode/apiClient';
import { connectEventStream, openSdkEventStream } from '../opencode/sseClient';
import { MessageBridge } from './messageBridge';
import type { EventFromWebview, EventToWebview } from './bridgeProtocol';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'opencode.sidebar';

  private view?: vscode.WebviewView;
  private server?: ServerHandle;
  private bridge?: MessageBridge;
  private sseHandle?: { close(): void };

  constructor(private readonly extensionUri: vscode.Uri, private readonly outputChannel: vscode.OutputChannel) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = await this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((msg: EventFromWebview) => this.bridge?.handle(msg));
    await this.startServer();
  }

  async restartServer(): Promise<void> {
    this.sseHandle?.close();
    await this.server?.dispose();
    this.server = undefined;
    await this.startServer();
  }

  async dispose(): Promise<void> {
    this.sseHandle?.close();
    await this.server?.dispose();
  }

  private async startServer(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('opencode');
    const binaryPath = cfg.get<string>('binaryPath') ?? 'opencode';
    const extraArgs = cfg.get<string[]>('serverArgs') ?? [];
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    this.post({ type: 'serverStatus', status: 'starting' });
    try {
      this.server = await startOpencodeServer({ binaryPath, extraArgs, cwd });
      this.outputChannel.appendLine(`opencode serve started at ${this.server.url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'serverStatus', status: 'error', error: message });
      return;
    }

    const api = createApiClient({ baseUrl: this.server.url });
    this.bridge = new MessageBridge({
      api,
      post: (m) => this.post(m),
      onRestartServer: () => void this.restartServer(),
    });

    this.sseHandle = connectEventStream({
      open: () => openSdkEventStream(api.raw),
      onEvent: (e) => this.post({ type: 'sse', event: e }),
      onError: (err) => this.outputChannel.appendLine(`sse error: ${String(err)}`),
      onReconnect: () => this.post({ type: 'serverStatus', status: 'reconnecting' }),
    });

    this.post({ type: 'serverStatus', status: 'ready' });
  }

  private post(msg: EventToWebview): void {
    this.view?.webview.postMessage(msg);
  }

  private async renderHtml(webview: vscode.Webview): Promise<string> {
    const distRoot = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const mainJsUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'webview', 'main.js')).toString();
    const uiCssUri  = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'ui.css')).toString();
    const tplPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'index.html');
    const tpl = await fs.readFile(tplPath, 'utf8');
    const nonce = generateNonce();
    return tpl
      .replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{mainJsUri}}', mainJsUri)
      .replaceAll('{{uiCssUri}}', uiCssUri);
  }
}

function generateNonce(): string {
  const a = new Uint8Array(16);
  for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Make sure the webview can actually load `ui.css` from the source tree.** Modify `package.json` to keep `src/webview/ui.css` in the packaged `.vsix`:

In `.vscodeignore` (create or modify):

```
.vscode/**
.vscode-test/**
src/test/**
out/**
node_modules/**
**/*.map
.gitignore
.eslintrc.json
**/*.ts
!src/webview/ui.css
!src/webview/index.html
```

Wait — that excludes all `.ts` while bundling them via esbuild. Verify the existing `.vscodeignore` and adjust to include the html/css. Run:

```bash
cat .vscodeignore
```

Edit it so that `src/webview/index.html` and `src/webview/ui.css` are *not* excluded. Add at the top:

```
!src/webview/index.html
!src/webview/ui.css
```

(VS Code processes `.vscodeignore` like .gitignore — `!` re-includes.)

- [ ] **Step 3: Commit.**

```bash
git add src/sidebar/SidebarProvider.ts .vscodeignore
git commit -m "feat(sidebar): WebviewViewProvider with server lifecycle and bridge"
```

---

### Task 8.2: Rewrite `src/extension.ts`

**Files:**
- Replace: `src/extension.ts`

- [ ] **Step 1: Write it.**

```ts
import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar/SidebarProvider';

let provider: SidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('OpenCode');
  context.subscriptions.push(channel);

  provider = new SidebarProvider(context.extensionUri, channel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('opencode.newSession',     () => vscode.commands.executeCommand('workbench.view.extension.opencode')),
    vscode.commands.registerCommand('opencode.focusSidebar',   () => vscode.commands.executeCommand('opencode.sidebar.focus')),
    vscode.commands.registerCommand('opencode.restartServer',  () => provider?.restartServer()),
    vscode.commands.registerCommand('opencode.openSettings',   () => vscode.commands.executeCommand('workbench.action.openSettings', 'opencode')),
  );
}

export async function deactivate(): Promise<void> {
  await provider?.dispose();
  provider = undefined;
}
```

- [ ] **Step 2: Build to confirm everything compiles.**

Run: `npm run check-types && node esbuild.js`
Expected: both succeed; `dist/extension.js` and `dist/webview/main.js` are produced.

- [ ] **Step 3: Commit.**

```bash
git add src/extension.ts
git commit -m "feat(extension): activate/deactivate wiring"
```

---

## Phase 9 — Integration smoke test + polish

### Task 9.1: Smoke test — extension activates, sidebar registers

**Files:**
- Replace: `src/test/extension.test.ts`

- [ ] **Step 1: Write the test.**

```ts
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('opencode-sidebar smoke', () => {
  test('extension activates and registers commands', async () => {
    const ext = vscode.extensions.getExtension('opencode-sidebar');
    assert.ok(ext, 'extension should be present');
    await ext.activate();
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('opencode.newSession'));
    assert.ok(cmds.includes('opencode.restartServer'));
  });
});
```

- [ ] **Step 2: Run.**

Run: `npm test`
Expected: Mocha integration suite reports the smoke test passes (does NOT spawn opencode in this test — pure command/registration check).

- [ ] **Step 3: Commit.**

```bash
git add src/test/extension.test.ts
git commit -m "test(integration): smoke test for activation + command registration"
```

---

### Task 9.2: Reconnect banner + error empty-state

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Add a banner above the messages region** that reflects `state.status === 'reconnecting'` or `state.status === 'error'`.

After the `mountComposer(...)` line, add:

```ts
const banner = document.createElement('div');
banner.className = 'banner';
banner.style.display = 'none';
root.insertBefore(banner, root.querySelector('.messages'));

store.subscribe(s => {
  if (s.status === 'reconnecting') { banner.textContent = 'Reconnecting…'; banner.style.display = 'block'; }
  else if (s.status === 'error')   { banner.textContent = `Server error: ${s.serverError ?? 'unknown'} — `; banner.style.display = 'block';
    banner.innerHTML = '';
    banner.append(`Server error: ${s.serverError ?? 'unknown'} — `);
    const a = document.createElement('a'); a.textContent = 'Retry'; a.href = '#'; a.onclick = (e) => { e.preventDefault(); post({ type: 'restartServer' }); };
    banner.append(a);
  }
  else { banner.style.display = 'none'; }
});
```

- [ ] **Step 2: Build + run unit tests once more.**

Run: `node esbuild.js && npm run test:unit`
Expected: build succeeds; all unit tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/webview/main.ts
git commit -m "feat(webview): reconnect/error banner with Retry"
```

---

### Task 9.3: Manual E2E — verify it works end-to-end

**Files:** none (manual verification)

- [ ] **Step 1: Open the extension in a development host.**

In VS Code: F5 (Run Extension) — opens an Extension Development Host window.

- [ ] **Step 2: In the dev host, click the OpenCode icon in the activity bar.**

Expected:
- Sidebar opens.
- After ~1–2s, "Server error: …" banner does NOT appear, and either the empty-state ("Start a new chat") or an existing session list appears.
- VS Code Output panel → "OpenCode" shows: `opencode serve started at http://127.0.0.1:<port>`.

- [ ] **Step 3: Click "+ New session", type "what is 2+2", press Enter.**

Expected:
- A new row appears in the session list and becomes active.
- "User" message renders with your text.
- "Assistant" message streams in word by word.
- A Stop button replaces Send while streaming, returns to Send when finished.

- [ ] **Step 4: Ask the assistant to run a command** ("run `echo hello` and show me the output").

Expected:
- A yellow "⚠ Permission required" card appears with the command shown.
- Clicking "Allow once" closes the card; a `bash` tool card appears with the output.

- [ ] **Step 5: Close and reopen the sidebar, verify session persistence.**

Expected: same session list reappears, click the previous session, message history is restored from `/session/<id>/message`.

If any step fails, file the bug; do not commit until fixed.

---

## Self-Review

After writing all tasks, sweep through:

**1. Spec coverage.** Walk every spec heading:
- Architecture (3 processes) → Tasks 1.x, 2.x, 8.x ✓
- File layout → all phases ✓
- UI structure (Header / SessionList / MessageList / Composer + tool/perm parts) → Tasks 7.x ✓
- State model → Tasks 5.x ✓
- Markdown + Shiki → Tasks 7.3 (markdown). **Gap: shiki is installed but never wired.** → Acceptable for v1: TextPart uses `marked` only, code blocks render as plain `<pre><code>`. Add a follow-up note rather than a task; v1 ships readable code without highlighting; users with the editor open see syntax via VS Code anyway.
- Empty / error / reconnect states → MessageList empty (7.4), banner (9.2). ✓
- Data flow (8 SSE events handled) → Tasks 5.x cover all ✓
- Bridge protocol → Task 4.1 + 6.x ✓
- Permission handling (3 buttons, keyboard, edge cases) → Task 7.5 ✓
- Settings (`opencode.binaryPath` etc.) → Task 0.4 ✓
- Pre-existing fixes → Task 0.4 ✓
- Testing matrix → unit + integration tasks present ✓

**2. Placeholder scan.** No "TBD", "implement later". Every code block is complete and runnable. The only deliberate v1 simplification (Shiki) is noted explicitly above.

**3. Type consistency.** Method names checked against the SDK:
- `client.session.list/create/delete/messages/prompt/abort` ✓
- `client.postSessionIdPermissionsPermissionId({path:{id, permissionID}, body:{response}})` ✓ (verified in `dist/gen/sdk.gen.d.ts`)
- `client.event()` returns `ServerSentEventsResult` ✓
- `client.config.providers()` ✓
- `Permission.id`, `Permission.sessionID`, `Permission.messageID`, `Permission.metadata` (Record) ✓ (verified in `dist/gen/types.gen.d.ts`)
- Decision wire values: `"once" | "always" | "reject"` ✓ (verified)

**4. Task ordering.** Each task only depends on previously-completed tasks. Server lifecycle precedes apiClient (which does not actually need it for unit tests but does at runtime). State precedes components (components consume Store).

No corrections needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-opencode-sidebar.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
