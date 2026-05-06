// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountPermissionPart } from '../../webview/components/PermissionPart';
import type { PendingPermission } from '../../webview/state';

const perm: PendingPermission = { id: 'pp1', sessionId: 's1', messageId: 'm1', title: 'edit foo', metadata: {} };

describe('PermissionPart', () => {
  it('renders three buttons with correct decisions', () => {
    const el = document.createElement('div');
    const post = vi.fn();
    mountPermissionPart(el, perm, post);
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    (buttons[2] as HTMLButtonElement).click();
    expect(post.mock.calls.map(c => (c[0] as any).decision)).toEqual(['allow', 'once', 'deny']);
  });

  it('Esc denies, Enter chooses once', () => {
    const el = document.createElement('div');
    const post = vi.fn();
    mountPermissionPart(el, perm, post);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(post.mock.calls.map(c => (c[0] as any).decision)).toEqual(['deny', 'once']);
  });
});
