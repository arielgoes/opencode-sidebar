import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountSessionList(parent: HTMLElement, { store, post }: Deps): () => void {
  // Build outer wrapper: a thin header bar + collapsible list
  parent.innerHTML = `
    <div class="session-list-header">
      <span class="session-list-title">Sessions</span>
      <button class="icon-btn session-toggle" title="Toggle session list">▾</button>
    </div>
    <div class="session-list-body"></div>
  `;
  const header = parent.querySelector('.session-list-header') as HTMLElement;
  const body = parent.querySelector('.session-list-body') as HTMLElement;
  const toggle = parent.querySelector('.session-toggle') as HTMLButtonElement;

  let collapsed = false;
  const setCollapsed = (v: boolean) => {
    collapsed = v;
    body.style.display = collapsed ? 'none' : '';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.title = collapsed ? 'Show sessions' : 'Hide sessions';
  };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!collapsed); });

  const renderList = () => {
    const s = store.get();
    body.innerHTML = '';
    for (const row of s.sessions) {
      const div = document.createElement('div');
      div.className = 'session-row' + (row.id === s.activeSessionId ? ' active' : '');
      div.innerHTML = `<span class="title"></span><span class="time"></span><button class="icon-btn session-delete" title="Delete session">&#10005;</button>`;
      const titleEl = div.querySelector('.title') as HTMLElement;
      titleEl.textContent = row.title;
      (div.querySelector('.time') as HTMLElement).textContent = formatRel(row.updatedAt);
      const deleteBtn = div.querySelector('.session-delete') as HTMLButtonElement;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        post({ type: 'deleteSession', sessionId: row.id });
      });
      div.addEventListener('click', () => {
        post({ type: 'switchSession', sessionId: row.id });
        setCollapsed(true); // auto-collapse after picking a session
      });
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.value = row.title;
        input.style.cssText = 'flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-focusBorder);border-radius:2px;padding:0 4px;font:inherit;font-size:12px;';
        titleEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const newTitle = input.value.trim();
          if (newTitle && newTitle !== row.title) post({ type: 'renameSession', sessionId: row.id, title: newTitle });
          input.replaceWith(titleEl);
          titleEl.textContent = newTitle || row.title;
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          if (ev.key === 'Escape') { input.replaceWith(titleEl); }
        });
      });
      body.appendChild(div);
    }
    // Show active session title in the header when collapsed
    const active = s.sessions.find(x => x.id === s.activeSessionId);
    const titleSpan = header.querySelector('.session-list-title') as HTMLElement;
    titleSpan.textContent = active ? active.title : 'Sessions';
  };

  // Auto-collapse list when switching to a new (just-created) session
  store.subscribe(renderList);

  return () => {};
}

function formatRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h';
  return Math.floor(diff / 86_400_000) + 'd';
}
