import type { PendingPermission } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import type { PermissionDecision } from '../../opencode/types';

export function mountPermissionPart(el: HTMLElement, p: PendingPermission, post: (m: EventFromWebview) => void): void {
  el.className = 'permission';
  el.tabIndex = 0;
  el.innerHTML = `
    <div><strong>⚠ Permission required</strong> — <span class="perm-title"></span></div>
    <div class="perm-meta" style="font-family:var(--vscode-editor-font-family);font-size:11px;margin-top:6px;"></div>
    <div class="actions">
      <button class="btn btn-primary"   data-decision="allow">Allow</button>
      <button class="btn btn-secondary" data-decision="once">Allow once</button>
      <button class="btn btn-danger"    data-decision="deny">Deny</button>
    </div>
  `;
  (el.querySelector('.perm-title') as HTMLElement).textContent = p.title;
  (el.querySelector('.perm-meta') as HTMLElement).textContent = renderMeta(p);

  const reply = (decision: PermissionDecision) =>
    post({ type: 'permissionReply', sessionId: p.sessionId, permissionId: p.id, decision });

  el.querySelectorAll('button[data-decision]').forEach(b =>
    b.addEventListener('click', () => reply((b as HTMLButtonElement).dataset.decision as PermissionDecision)));

  el.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter')  { ev.preventDefault(); reply('once'); }
    if (ev.key === 'Escape') { ev.preventDefault(); reply('deny'); }
  });
}

function renderMeta(p: PendingPermission): string {
  const m = p.metadata as any;
  if (typeof m?.command === 'string') return '$ ' + m.command;
  if (typeof m?.diff === 'string')    return m.diff;
  if (Array.isArray(p.pattern))       return p.pattern.join(', ');
  if (typeof p.pattern === 'string')  return p.pattern;
  return '';
}
