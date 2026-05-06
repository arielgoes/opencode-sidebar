# Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Composer `<select>` dropdown with a rich model picker panel grouped by provider with search.

**Architecture:** New `ModelPicker.ts` component mounted inside the Composer container. A trigger button replaces the `<select>`. Panel is absolutely positioned above the Composer row, toggled open/closed. Models are grouped by parsing `provider/model` from the ID.

**Tech Stack:** TypeScript, vanilla DOM, VS Code webview CSS variables, Vitest+jsdom for tests.

---

### Task 1: Add `modelPickerOpen` to state

**Files:**
- Modify: `src/webview/state.ts`
- Test: `src/test/state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/test/state.test.ts` inside the `describe('reduce')` block:

```typescript
it('initialState has modelPickerOpen false', () => {
  const s = initialState();
  expect(s.modelPickerOpen).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/test/state.test.ts`
Expected: FAIL — `modelPickerOpen` does not exist on `State`

- [ ] **Step 3: Write minimal implementation**

In `src/webview/state.ts`, add `modelPickerOpen: boolean` to the `State` interface (line 24, after `serverError`):

```typescript
export interface State {
  // ... existing fields ...
  serverError: string | null;
  modelPickerOpen: boolean;
}
```

In `initialState()`, add `modelPickerOpen: false` (line 36, after `serverError: null`):

```typescript
    modelNotifications: [], serverError: null, modelPickerOpen: false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/test/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/state.ts src/test/state.test.ts
git commit -m "feat: add modelPickerOpen to state"
```

---

### Task 2: Create `groupModels` utility

**Files:**
- Create: `src/webview/components/modelPickerUtil.ts`
- Test: `src/test/components/modelPickerUtil.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/components/modelPickerUtil.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { groupModels, PROVIDER_LABELS } from '../../webview/components/modelPickerUtil';

describe('groupModels', () => {
  it('groups models by provider from id', () => {
    const models = [
      { id: 'openai/gpt-4', label: 'GPT-4' },
      { id: 'openai/gpt-3.5', label: 'GPT-3.5' },
      { id: 'anthropic/claude', label: 'Claude' },
    ];
    const groups = groupModels(models);
    expect(groups).toHaveLength(2);
    expect(groups[0].provider).toBe('openai');
    expect(groups[0].label).toBe('OpenAI');
    expect(groups[0].models.map(m => m.id)).toEqual(['openai/gpt-3.5', 'openai/gpt-4']);
    expect(groups[1].provider).toBe('anthropic');
    expect(groups[1].models).toHaveLength(1);
  });

  it('puts models without slash into Other group', () => {
    const models = [{ id: 'unknown-model', label: 'Unknown' }];
    const groups = groupModels(models);
    expect(groups).toHaveLength(1);
    expect(groups[0].provider).toBe('other');
    expect(groups[0].label).toBe('Other');
  });

  it('sorts known providers before unknown', () => {
    const models = [
      { id: 'zeta/model', label: 'Z' },
      { id: 'openai/gpt-4', label: 'GPT-4' },
    ];
    const groups = groupModels(models);
    expect(groups[0].provider).toBe('openai');
    expect(groups[1].provider).toBe('zeta');
  });

  it('returns empty array for no models', () => {
    expect(groupModels([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/test/components/modelPickerUtil.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/components/modelPickerUtil.ts`:

```typescript
export interface ModelOption { id: string; label: string; }
export interface ModelGroup { provider: string; label: string; models: ModelOption[]; }

export const PROVIDER_LABELS: Record<string, string> = {
  opencode: 'OpenCode Go',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
};

const KNOWN_ORDER = Object.keys(PROVIDER_LABELS);

export function groupModels(models: ModelOption[]): ModelGroup[] {
  if (models.length === 0) return [];

  const map = new Map<string, ModelOption[]>();
  for (const m of models) {
    const slash = m.id.indexOf('/');
    const provider = slash >= 0 ? m.id.slice(0, slash) : 'other';
    if (!map.has(provider)) map.set(provider, []);
    map.get(provider)!.push(m);
  }

  const groups: ModelGroup[] = [];
  for (const [provider, models] of map) {
    models.sort((a, b) => a.label.localeCompare(b.label));
    const label = provider === 'other' ? 'Other' : (PROVIDER_LABELS[provider] ?? capitalize(provider));
    groups.push({ provider, label, models });
  }

  groups.sort((a, b) => {
    const ai = KNOWN_ORDER.indexOf(a.provider);
    const bi = KNOWN_ORDER.indexOf(b.provider);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.label.localeCompare(b.label);
  });

  return groups;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/test/components/modelPickerUtil.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/modelPickerUtil.ts src/test/components/modelPickerUtil.test.ts
git commit -m "feat: add groupModels utility for provider grouping"
```

---

### Task 3: Create `ModelPicker` component

**Files:**
- Create: `src/webview/components/ModelPicker.ts`
- Test: `src/test/components/ModelPicker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/components/ModelPicker.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from '../../webview/state';
import { mountModelPicker } from '../../webview/components/ModelPicker';

function createStore(models: Array<{ id: string; label: string }>, selectedModel = ''): Store {
  const store = new Store();
  store.dispatch({
    type: 'ready',
    sessions: [{ id: 's1', title: 'a', updatedAt: 1 }],
    activeSessionId: 's1',
    defaultModel: selectedModel,
    models,
    directory: '',
  });
  return store;
}

describe('ModelPicker', () => {
  it('renders hidden by default', () => {
    const store = createStore([{ id: 'openai/gpt-4', label: 'GPT-4' }]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup } = mountModelPicker(el, { store, post });
    const panel = el.querySelector('.model-picker-panel');
    expect(panel).toBeTruthy();
    expect(panel!.classList.contains('open')).toBe(false);
    cleanup();
  });

  it('shows provider groups when opened', () => {
    const store = createStore([
      { id: 'openai/gpt-4', label: 'GPT-4' },
      { id: 'anthropic/claude', label: 'Claude' },
    ]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup, toggle } = mountModelPicker(el, { store, post });
    toggle();
    expect(el.querySelector('[data-provider=openai]')).toBeTruthy();
    expect(el.querySelector('[data-provider=anthropic]')).toBeTruthy();
    cleanup();
  });

  it('shows checkmark on selected model', () => {
    const store = createStore(
      [{ id: 'openai/gpt-4', label: 'GPT-4' }],
      'openai/gpt-4',
    );
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup, toggle } = mountModelPicker(el, { store, post });
    toggle();
    const row = el.querySelector('[data-model-id="openai/gpt-4"]');
    expect(row!.querySelector('.check')).toBeTruthy();
    cleanup();
  });

  it('clicking a model selects it and closes panel', () => {
    const store = createStore([{ id: 'openai/gpt-4', label: 'GPT-4' }]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup, toggle } = mountModelPicker(el, { store, post });
    toggle();
    const row = el.querySelector('[data-model-id="openai/gpt-4"]');
    row!.click();
    expect(el.querySelector('.model-picker-panel')!.classList.contains('open')).toBe(false);
    cleanup();
  });

  it('filters models when searching', () => {
    const store = createStore([
      { id: 'openai/gpt-4', label: 'GPT-4' },
      { id: 'openai/gpt-3.5', label: 'GPT-3.5' },
    ]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup, toggle } = mountModelPicker(el, { store, post });
    toggle();
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'gpt-4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = el.querySelectorAll('.model-row');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('[data-model-id="openai/gpt-4"]')).toBeTruthy();
    cleanup();
  });

  it('shows empty message when no models', () => {
    const store = createStore([]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup, toggle } = mountModelPicker(el, { store, post });
    toggle();
    expect(el.textContent).toContain('no models available');
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/test/components/ModelPicker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/components/ModelPicker.ts`:

```typescript
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { groupModels } from './modelPickerUtil';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountModelPicker(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.innerHTML = `
    <div class="model-picker-panel">
      <div class="model-picker-topbar">
        <input type="text" class="model-picker-search" placeholder="Search models" />
        <button class="icon-btn model-picker-settings" title="Settings">⚙</button>
      </div>
      <div class="model-picker-body"></div>
    </div>
  `;

  const panel = parent.querySelector('.model-picker-panel') as HTMLElement;
  const body = parent.querySelector('.model-picker-body') as HTMLElement;
  const search = parent.querySelector('.model-picker-search') as HTMLInputElement;

  let filter = '';

  const render = () => {
    const s = store.get();
    panel.classList.toggle('open', s.modelPickerOpen);

    const groups = groupModels(s.availableModels);
    const filtered = filter
      ? groups.map(g => ({ ...g, models: g.models.filter(m => m.label.toLowerCase().includes(filter.toLowerCase())) }))
                .filter(g => g.models.length > 0)
      : groups;

    if (filtered.length === 0 && s.availableModels.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no models available</div>';
      return;
    }
    if (filtered.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no matching models</div>';
      return;
    }

    let html = '';
    for (const g of filtered) {
      html += `<div class="model-picker-group" data-provider="${g.provider}">`;
      html += `<div class="model-picker-group-label">${g.label}</div>`;
      for (const m of g.models) {
        const selected = m.id === s.composer.model;
        html += `<div class="model-row" data-model-id="${m.id}">`;
        html += `<span class="model-label">${m.label}</span>`;
        if (selected) html += `<span class="check">✓</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  };

  search.addEventListener('input', () => {
    filter = search.value;
    render();
  });

  body.addEventListener('click', (e: Event) => {
    const row = (e.target as HTMLElement).closest('.model-row') as HTMLElement | null;
    if (!row) return;
    const modelId = row.dataset.modelId;
    if (!modelId) return;
    const s = store.get();
    store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: modelId, models: s.availableModels, directory: '' });
    panel.classList.remove('open');
  });

  const cleanup = store.subscribe(render);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const s = store.get();
      if (s.modelPickerOpen) {
        store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: s.composer.model, models: s.availableModels, directory: '' });
      }
    }
  };
  window.addEventListener('keydown', onKeydown);

  const onClickOutside = (e: MouseEvent) => {
    if (!panel.contains(e.target as Node)) {
      const s = store.get();
      if (s.modelPickerOpen) {
        store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: s.composer.model, models: s.availableModels, directory: '' });
      }
    }
  };
  document.addEventListener('click', onClickOutside);

  return () => {
    cleanup();
    window.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onClickOutside);
  };
}
```

Note: The Escape and click-outside handlers toggle `modelPickerOpen` by re-dispatching `ready` with the current state. This is a bit awkward — the `reduce` function in state.ts doesn't toggle `modelPickerOpen` on `ready`. We need to handle this differently.

Actually, looking at the spec more carefully: `modelPickerOpen` is client-side only state. The `ready` event doesn't touch it. Let me add a way to toggle it. The cleanest approach is to handle the toggle directly in the component without going through the store reducer — just manipulate the DOM class. But that breaks the pattern.

Better approach: add a `toggleModelPicker` action that only flips `modelPickerOpen`. But the spec says no bridge changes needed. Let me just use a local variable in the component for open state, and only use `modelPickerOpen` from state for initial render.

Actually, re-reading the spec: "Add `modelPickerOpen: boolean` to State" — it's in the state but the spec says "No bridge protocol changes needed — the picker is fully client-side." So the state field exists but we don't need to dispatch events to change it. The component can just track open state locally and use the state field for rendering.

Let me simplify: the component tracks `open` locally, and `modelPickerOpen` in state is just for initial state. The render reads from state but the click handlers manage the panel directly.

Revised implementation — use local `open` variable, sync with state on render:

```typescript
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { groupModels } from './modelPickerUtil';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountModelPicker(parent: HTMLElement, { store, post }: Deps): { cleanup: () => void; toggle: () => void } {
  parent.innerHTML = `
    <div class="model-picker-panel">
      <div class="model-picker-topbar">
        <input type="text" class="model-picker-search" placeholder="Search models" />
        <button class="icon-btn model-picker-settings" title="Settings"></button>
      </div>
      <div class="model-picker-body"></div>
    </div>
  `;

  const panel = parent.querySelector('.model-picker-panel') as HTMLElement;
  const body = parent.querySelector('.model-picker-body') as HTMLElement;
  const search = parent.querySelector('.model-picker-search') as HTMLInputElement;

  let open = false;
  let filter = '';

  const render = () => {
    const s = store.get();
    panel.classList.toggle('open', open);

    const groups = groupModels(s.availableModels);
    const filtered = filter
      ? groups.map(g => ({ ...g, models: g.models.filter(m => m.label.toLowerCase().includes(filter.toLowerCase())) }))
                .filter(g => g.models.length > 0)
      : groups;

    if (filtered.length === 0 && s.availableModels.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no models available</div>';
      return;
    }
    if (filtered.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no matching models</div>';
      return;
    }

    let html = '';
    for (const g of filtered) {
      html += `<div class="model-picker-group" data-provider="${g.provider}">`;
      html += `<div class="model-picker-group-label">${g.label}</div>`;
      for (const m of g.models) {
        const selected = m.id === s.composer.model;
        html += `<div class="model-row" data-model-id="${m.id}">`;
        html += `<span class="model-label">${m.label}</span>`;
        if (selected) html += `<span class="check">✓</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  };

  search.addEventListener('input', () => {
    filter = search.value;
    render();
  });

  body.addEventListener('click', (e: Event) => {
    const row = (e.target as HTMLElement).closest('.model-row') as HTMLElement | null;
    if (!row) return;
    const modelId = row.dataset.modelId;
    if (!modelId) return;
    const s = store.get();
    store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: modelId, models: s.availableModels, directory: '' });
    open = false;
    render();
  });

  const cleanup = store.subscribe(render);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      open = false;
      render();
    }
  };
  window.addEventListener('keydown', onKeydown);

  const onClickOutside = (e: MouseEvent) => {
    if (open && !panel.contains(e.target as Node)) {
      open = false;
      render();
    }
  };
  document.addEventListener('click', onClickOutside);

  const toggle = () => { open = !open; render(); };
  const fullCleanup = () => { cleanup(); window.removeEventListener('keydown', onKeydown); document.removeEventListener('click', onClickOutside); };

  return { cleanup: fullCleanup, toggle };
}
```

Wait, I realize the `modelPickerOpen` state field isn't actually used by the component in this design. The spec says to add it but the component manages open state locally. Let me keep the state field for potential future use (e.g., if we want to persist it) but the component uses local state. The tests should reflect this.

Let me update the first test — it checks that the panel doesn't have the `open` class by default, which is correct since `open` starts as `false` locally.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/test/components/ModelPicker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/ModelPicker.ts src/test/components/ModelPicker.test.ts
git commit -m "feat: add ModelPicker component with grouping and search"
```

---

### Task 4: Add CSS for model picker

**Files:**
- Modify: `src/webview/ui.css`

- [ ] **Step 1: Add CSS rules**

Append to `src/webview/ui.css`:

```css
/* Model Picker */
.model-picker-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  margin-bottom: 4px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  display: none;
}
.model-picker-panel.open { display: flex; }

.model-picker-topbar {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
  border-bottom: 1px solid var(--vscode-input-border);
}
.model-picker-search {
  flex: 1;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  outline: none;
}
.model-picker-search:focus { border-color: var(--vscode-focusBorder); }
.model-picker-settings { padding: 2px 4px; }

.model-picker-body {
  overflow: auto;
  flex: 1;
}

.model-picker-group { padding: 2px 0; }
.model-picker-group-label {
  padding: 4px 10px 2px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.5;
}

.model-row {
  display: flex;
  align-items: center;
  padding: 5px 10px;
  cursor: pointer;
  gap: 6px;
  font-size: 12px;
}
.model-row:hover { background: var(--vscode-list-hoverBackground); }
.model-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.check { color: var(--vscode-textLink-foreground); font-size: 12px; }

.model-picker-empty {
  padding: 12px;
  text-align: center;
  opacity: 0.5;
  font-size: 12px;
}
```

- [ ] **Step 2: Verify no lint errors**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/webview/ui.css
git commit -m "style: add model picker CSS"
```

---

### Task 5: Integrate ModelPicker into Composer

**Files:**
- Modify: `src/webview/components/Composer.ts`
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/test/components/Composer.test.ts`:

```typescript
it('trigger button opens model picker', () => {
  const store = new Store();
  store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude', models: [{ id: 'anthropic/claude', label: 'Claude' }], directory: '' });
  const el = document.createElement('div');
  const post = vi.fn();
  mountComposer(el, { store, post });
  const trigger = el.querySelector('.model-trigger') as HTMLButtonElement;
  const panel = el.querySelector('.model-picker-panel');
  expect(panel!.classList.contains('open')).toBe(false);
  trigger.click();
  expect(panel!.classList.contains('open')).toBe(true);
});

it('shows current model label on trigger button', () => {
  const store = new Store();
  store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude', models: [{ id: 'anthropic/claude', label: 'Claude' }], directory: '' });
  const el = document.createElement('div');
  const post = vi.fn();
  mountComposer(el, { store, post });
  const trigger = el.querySelector('.model-trigger') as HTMLButtonElement;
  expect(trigger.textContent).toContain('Claude');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/test/components/Composer.test.ts`
Expected: FAIL — `.model-trigger` not found (still has `<select>`)

- [ ] **Step 3: Rewrite Composer to use ModelPicker**

Replace `src/webview/components/Composer.ts` with:

```typescript
import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { mountModelPicker } from './ModelPicker';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountComposer(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.innerHTML = `
    <textarea rows="2" placeholder="Ask opencode..."></textarea>
    <div class="row">
      <button class="model-trigger" title="Select model"></button>
      <div class="model-picker-container" style="position:relative;"></div>
      <button class="btn btn-secondary stop-btn" title="Stop" style="display:none;padding:4px 8px;">■</button>
      <button class="btn btn-primary send-btn">Send</button>
    </div>
  `;

  const ta = parent.querySelector('textarea') as HTMLTextAreaElement;
  const sendBtn = parent.querySelector('.send-btn') as HTMLButtonElement;
  const stopBtn = parent.querySelector('.stop-btn') as HTMLButtonElement;
  const trigger = parent.querySelector('.model-trigger') as HTMLButtonElement;
  const pickerContainer = parent.querySelector('.model-picker-container') as HTMLElement;

  const { toggle: togglePicker, cleanup: pickerCleanup } = mountModelPicker(pickerContainer, { store, post });

  trigger.addEventListener('click', () => { togglePicker(); });

  const send = () => {
    const s = store.get();
    if (!s.activeSessionId) return;
    const text = ta.value.trim();
    if (!text) return;
    const model = s.composer.model || undefined;
    post({ type: 'send', sessionId: s.activeSessionId, text, model });
    ta.value = '';
  };
  const stop = () => {
    const s = store.get();
    if (s.activeSessionId) post({ type: 'stop', sessionId: s.activeSessionId });
  };

  ta.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(130, ta.scrollHeight) + 'px';
  });

  const render = () => {
    const s = store.get();
    const label = s.availableModels.find(m => m.id === s.composer.model)?.label ?? s.composer.model ?? '(default)';
    trigger.textContent = label;

    const streaming = s.status === 'streaming';
    stopBtn.style.display = streaming ? 'inline-block' : 'none';
    stopBtn.onclick = stop;
    sendBtn.onclick = send;
  };

  const storeCleanup = store.subscribe(render);
  return () => { storeCleanup(); pickerCleanup(); };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/test/components/Composer.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npm run test:unit`
Expected: All PASS

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run check-types && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/webview/components/Composer.ts src/webview/components/ModelPicker.ts src/webview/components/modelPickerUtil.ts src/webview/ui.css src/test/components/Composer.test.ts src/test/components/ModelPicker.test.ts src/test/components/modelPickerUtil.test.ts src/webview/state.ts src/test/state.test.ts
git commit -m "feat: integrate ModelPicker into Composer, replace select dropdown"
```

---

### Task 6: Update main.ts to not mount anything extra

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Verify no changes needed**

The `mountComposer` call in `main.ts` already passes `{ store, post }`. The new Composer internally calls `mountModelPicker`. No changes needed to `main.ts`.

- [ ] **Step 2: Final verification**

Run: `npm run compile`
Expected: PASS — builds without errors

- [ ] **Step 3: Commit (if any changes were made)**

```bash
git status
# If no changes, skip commit
```
