import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountSessionSwitcher(parent: HTMLElement, { store, post }: Deps): () => void {
  const render = () => {
    const s = store.get();
    const current = s.sessions.find(sess => sess.id === s.activeSessionId);
    const currentTitle = current?.title || '(untitled)';
    
    parent.innerHTML = `
      <div class="session-bar">
        <button class="session-btn session-new" title="New session">+ New</button>
        <div class="session-dropdown">
          <button class="session-btn session-current" title="Switch session">
            <span class="session-title">${escapeHtml(currentTitle)}</span>
            <span class="session-chevron">▾</span>
          </button>
          <div class="session-list">
            ${s.sessions.map(sess => `
              <div class="session-item${sess.id === s.activeSessionId ? ' active' : ''}" data-session-id="${sess.id}">
                <span class="session-item-title">${escapeHtml(sess.title || '(untitled)')}</span>
                <button class="session-item-delete" data-delete-id="${sess.id}" title="Delete session">✕</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    parent.querySelector('.session-new')?.addEventListener('click', () => post({ type: 'newSession' }));
    
    const dropdown = parent.querySelector('.session-dropdown') as HTMLElement;
    const currentBtn = dropdown.querySelector('.session-current') as HTMLElement;
    const list = dropdown.querySelector('.session-list') as HTMLElement;
    let open = false;

    const toggle = () => {
      open = !open;
      list.style.display = open ? 'block' : 'none';
    };

    currentBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener('click', () => { if (open) { open = false; list.style.display = 'none'; } });

    list.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('session-item-delete')) return;
        const id = (item as HTMLElement).getAttribute('data-session-id')!;
        post({ type: 'switchSession', sessionId: id });
        open = false;
        list.style.display = 'none';
      });
    });

    list.querySelectorAll('.session-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).getAttribute('data-delete-id')!;
        post({ type: 'deleteSession', sessionId: id });
      });
    });
  };

  return store.subscribe(render);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
