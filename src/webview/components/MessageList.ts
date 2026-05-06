import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { mountTextPart } from './TextPart';
import { mountToolPart } from './ToolPart';
import { mountPermissionPart } from './PermissionPart';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountMessageList(parent: HTMLElement, { store, post }: Deps): () => void {
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
    let lastRole: string | null = null;
    let notifIdx = 0;

    for (const id of ids) {
      const parts = s.partsByMessage.get(id) ?? [];
      const role = s.messageRoles.get(id) ?? 'assistant';
      const isUser = role === 'user';

      // Collect all text content and tool parts for this message
      const textParts = parts.filter((p: any) => p.type === 'text' && p.text?.trim());
      const toolParts = parts.filter((p: any) => p.type === 'tool');

      // Inject model-change notifications before user messages
      if (isUser && notifIdx < s.modelNotifications.length) {
        const notif = s.modelNotifications[notifIdx++];
        const div = document.createElement('div');
        div.className = 'model-change-notice';
        div.textContent = notif.from
          ? `↕ Switched from ${notif.from} → ${notif.to}`
          : `⚙ Using ${notif.to}`;
        parent.appendChild(div);
      }

      // Show role label only when role changes
      if (role !== lastRole && (textParts.length > 0 || toolParts.length > 0)) {
        const roleLbl = document.createElement('div');
        roleLbl.className = 'role';
        roleLbl.textContent = isUser ? 'You' : 'Assistant';
        parent.appendChild(roleLbl);
        lastRole = role;
      }

      // User messages: single bubble with all text
      if (isUser) {
        const bubble = document.createElement('div');
        bubble.className = 'msg-user';
        for (const p of textParts as any[]) {
          const line = document.createElement('div');
          line.textContent = p.text;
          bubble.appendChild(line);
        }
        if (bubble.childNodes.length > 0) parent.appendChild(bubble);
        continue;
      }

      // Assistant messages: render tool parts first, then text inline
      for (const p of toolParts as any[]) {
        const wrap = document.createElement('div');
        mountToolPart(wrap, p);
        parent.appendChild(wrap);
      }
      for (const p of textParts as any[]) {
        const body = document.createElement('div');
        body.className = 'msg-assistant';
        mountTextPart(body, p.text ?? '');
        parent.appendChild(body);
      }
    }

    if (s.pendingPermission && s.pendingPermission.sessionId === s.activeSessionId) {
      const pp = document.createElement('div');
      mountPermissionPart(pp, s.pendingPermission, post);
      parent.appendChild(pp);
    }

    // Session error (e.g. model auth failure, quota)
    if (s.sessionError) {
      const errEl = document.createElement('div');
      errEl.className = 'session-error';
      errEl.innerHTML = `<span class="session-error-icon">⚠</span> <span></span>`;
      (errEl.querySelector('span:last-child') as HTMLElement).textContent = s.sessionError;
      parent.appendChild(errEl);
    }

    // Real processing indicator: shows only while server says it's busy
    if (s.sessionProcessing && !s.pendingPermission) {
      const ind = document.createElement('div');
      ind.className = 'thinking-indicator';
      if (s.sessionRetry) {
        ind.innerHTML = `<span class="thinking-retry">${s.sessionRetry}</span>`;
      } else {
        ind.innerHTML = `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>`;
      }
      parent.appendChild(ind);
    }

    if (pinned) parent.scrollTop = parent.scrollHeight;
  };

  return store.subscribe(render);
}
