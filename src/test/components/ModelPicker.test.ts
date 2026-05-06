// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountModelPicker } from '../../webview/components/ModelPicker';

function createStore(models: Array<{ id: string; label: string; contextLimit?: number }>, selectedModel = ''): Store {
  const store = new Store();
  store.dispatch({
    type: 'ready',
    sessions: [{ id: 's1', title: 'a', updatedAt: 1 }],
    activeSessionId: 's1',
    defaultModel: selectedModel,
    models,
    directory: '',
    lspCount: 0,
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
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
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
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
    const row = el.querySelector('[data-model-id="openai/gpt-4"]');
    expect(row!.querySelector('.check')).toBeTruthy();
    cleanup();
  });

  it('clicking a model selects it and closes panel', () => {
    const store = createStore([{ id: 'openai/gpt-4', label: 'GPT-4' }]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
    const row = el.querySelector('[data-model-id="openai/gpt-4"]');
    (row! as HTMLElement).click();
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
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'gpt-4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = el.querySelectorAll('.model-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-model-id')).toBe('openai/gpt-4');
    cleanup();
  });

  it('shows empty message when no models', () => {
    const store = createStore([]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
    expect(el.textContent).toContain('no models available');
    cleanup();
  });

  it('shows context limit in model rows', () => {
    const store = createStore([{ id: 'openai/gpt-4', label: 'GPT-4', contextLimit: 128000 }]);
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup } = mountModelPicker(el, { store, post });
    (el.querySelector('.model-trigger') as HTMLElement).click();
    expect(el.querySelector('.model-ctx-info')!.textContent).toContain('128k');
    cleanup();
  });

  it('shows model label on trigger', () => {
    const store = createStore([{ id: 'openai/gpt-4', label: 'GPT-4' }], 'openai/gpt-4');
    const el = document.createElement('div');
    const post = vi.fn();
    const { cleanup } = mountModelPicker(el, { store, post });
    expect(el.querySelector('.model-trigger-label')!.textContent).toBe('GPT-4');
    cleanup();
  });
});
