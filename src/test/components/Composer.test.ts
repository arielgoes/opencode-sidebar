// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountComposer } from '../../webview/components/Composer';

describe('Composer', () => {
  it('Enter sends message; Shift+Enter inserts newline', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude', models: [{ id: 'anthropic/claude', label: 'anthropic / claude' }], directory: '', lspCount: 0, serverUrl: '' });
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

  it('shows Stop button while streaming; Send is always visible', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: null, models: [], directory: '', lspCount: 0, serverUrl: '' });
    store.dispatch({ type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    const el = document.createElement('div');
    const post = vi.fn();
    mountComposer(el, { store, post });
    const stopBtn = el.querySelector('.stop-btn') as HTMLButtonElement;
    const sendBtn = el.querySelector('.send-btn') as HTMLButtonElement;
    expect(stopBtn.style.display).not.toBe('none');
    stopBtn.click();
    expect(post).toHaveBeenCalledWith({ type: 'stop', sessionId: 's1' });
    expect(sendBtn).toBeTruthy();
  });

  it('trigger button opens model picker', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude', models: [{ id: 'anthropic/claude', label: 'Claude' }], directory: '', lspCount: 0, serverUrl: '' });
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
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude', models: [{ id: 'anthropic/claude', label: 'Claude' }], directory: '', lspCount: 0, serverUrl: '' });
    const el = document.createElement('div');
    const post = vi.fn();
    mountComposer(el, { store, post });
    const labelEl = el.querySelector('.model-trigger-label') as HTMLElement;
    expect(labelEl.textContent).toContain('Claude');
  });
});
