// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../webview/state';
import { mountSessionList } from '../../webview/components/SessionList';

describe('SessionList', () => {
  it('renders one row per session and marks the active one', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 'a', title: 'Alpha', updatedAt: 1 }, { id: 'b', title: 'Beta', updatedAt: 2 }], activeSessionId: 'b', defaultModel: null, models: [], directory: '', lspCount: 0 });
    const el = document.createElement('div');
    mountSessionList(el, { store, post: vi.fn() });
    const rows = el.querySelectorAll('.session-row');
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains('active')).toBe(true);
    expect(rows[0].textContent).toContain('Alpha');
  });

  it('clicking a row posts switchSession', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 'a', title: 'Alpha', updatedAt: 1 }], activeSessionId: 'a', defaultModel: null, models: [], directory: '', lspCount: 0 });
    const el = document.createElement('div');
    const post = vi.fn();
    mountSessionList(el, { store, post });
    (el.querySelector('.session-row') as HTMLElement).click();
    expect(post).toHaveBeenCalledWith({ type: 'switchSession', sessionId: 'a' });
  });

  it('clicking delete button posts deleteSession without switching', () => {
    const store = new Store();
    store.dispatch({ type: 'ready', sessions: [{ id: 'a', title: 'Alpha', updatedAt: 1 }, { id: 'b', title: 'Beta', updatedAt: 2 }], activeSessionId: 'a', defaultModel: null, models: [], directory: '', lspCount: 0 });
    const el = document.createElement('div');
    const post = vi.fn();
    mountSessionList(el, { store, post });
    const rows = el.querySelectorAll('.session-row');
    const deleteBtn = rows[1].querySelector('.session-delete') as HTMLButtonElement;
    deleteBtn.click();
    expect(post).toHaveBeenCalledWith({ type: 'deleteSession', sessionId: 'b' });
  });
});
