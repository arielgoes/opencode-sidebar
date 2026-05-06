// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountMessageList } from '../../webview/components/MessageList';

describe('MessageList', () => {
  it('shows empty state with New Session button when no active session', () => {
    const store = new Store();
    const el = document.createElement('div');
    const post = vi.fn();
    mountMessageList(el, { store, post });
    const btn = el.querySelector('[data-action=new]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(post).toHaveBeenCalledWith({ type: 'newSession' });
  });

  it('renders text parts in order', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: null, models: [], directory: '', lspCount: 0 });
    store.dispatch({ type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    store.dispatch({ type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hello world' } } } as any });
    const el = document.createElement('div');
    mountMessageList(el, { store, post: vi.fn() });
    expect(el.textContent).toContain('hello world');
  });

  it('renders tool parts', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 's1', title: 'a', updatedAt: 1 }], activeSessionId: 's1', defaultModel: null, models: [], directory: '', lspCount: 0 });
    store.dispatch({ type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    store.dispatch({ type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p2', messageID: 'm1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt' } } } } as any });
    const el = document.createElement('div');
    mountMessageList(el, { store, post: vi.fn() });
    expect(el.querySelector('.tool-card')).toBeTruthy();
    expect(el.textContent).toContain('bash');
  });
});
