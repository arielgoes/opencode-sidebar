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
      parent.innerHTML = `
        <div class="empty">
          <div class="empty-icon">▢</div>
          <div class="empty-title">Build anything</div>
          <div class="empty-hint">Start a session and ask away</div>
          <button class="empty-cta" data-action="new">+ New session</button>
        </div>`;
      parent.querySelector('[data-action=new]')?.addEventListener('click', () => post({ type: 'newSession' }));
      return;
    }

    const ids = s.messageIdsBySession.get(s.activeSessionId) ?? [];

    for (const id of ids) {
      const parts = s.partsByMessage.get(id) ?? [];
      const role = s.messageRoles.get(id) ?? 'assistant';
      const isUser = role === 'user';

      // Collect all text content and tool parts for this message
      const textParts = parts.filter((p: any) => p.type === 'text' && p.text?.trim());
      const toolParts = parts.filter((p: any) => p.type === 'tool');

      // User messages: single card with all text
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
        // Skip tool parts with no meaningful data
        if (!p.tool || !p.state || !p.state.status) continue;
        // Skip completed/error tools with no output (stale/empty — wait for output)
        const hasOutput = p.state.output && p.state.output.trim();
        const isActive = p.state.status === 'running' || p.state.status === 'pending';
        if (!hasOutput && !isActive) continue;
        const wrap = document.createElement('div');
        mountToolPart(wrap, p, { sessionId: s.activeSessionId ?? '', post });
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
        const elapsed = s.processingSince ? Math.floor((Date.now() - s.processingSince) / 1000) : 0;
        const stalled = elapsed > 30;
        ind.innerHTML = `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-label">${stalled ? `Stuck (${elapsed}s) — check Output → OpenCode` : 'Thinking…'}</span>`;
      }
      parent.appendChild(ind);
    }

    if (pinned || s.sessionProcessing) parent.scrollTop = parent.scrollHeight;
  };

  return store.subscribe(render);
}
