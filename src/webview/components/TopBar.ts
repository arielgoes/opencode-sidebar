import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountTopBar(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.innerHTML = `
    <button class="session-switcher" title="Switch session">
      <span class="session-switcher-title">New chat</span>
      <span class="session-switcher-chevron">▾</span>
    </button>
    <button class="new-session-btn" title="New session">+</button>
    <div class="session-dropdown" hidden></div>
  `;

  const switcher = parent.querySelector('.session-switcher') as HTMLButtonElement;
  const titleEl = parent.querySelector('.session-switcher-title') as HTMLElement;
  const newBtn = parent.querySelector('.new-session-btn') as HTMLButtonElement;
  const dropdown = parent.querySelector('.session-dropdown') as HTMLElement;

  let open = false;
  const setOpen = (v: boolean) => { open = v; dropdown.hidden = !open; };

  switcher.addEventListener('click', e => { e.stopPropagation(); setOpen(!open); });
  document.addEventListener('click', () => setOpen(false));
  dropdown.addEventListener('click', e => e.stopPropagation());
  newBtn.addEventListener('click', () => { post({ type: 'newSession' }); setOpen(false); });

  const render = () => {
    const s = store.get();
    const active = s.sessions.find(x => x.id === s.activeSessionId);
    titleEl.textContent = active?.title || 'New chat';

    dropdown.innerHTML = '';
    if (s.sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-dropdown-empty';
      empty.textContent = 'No sessions yet';
      dropdown.appendChild(empty);
      return;
    }
    for (const row of s.sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' + (row.id === s.activeSessionId ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'session-item-title';
      title.textContent = row.title;
      const time = document.createElement('span');
      time.className = 'session-item-time';
      time.textContent = formatRel(row.updatedAt);
      const del = document.createElement('button');
      del.className = 'session-item-delete';
      del.title = 'Delete session';
      del.innerHTML = '&#10005;';
      del.addEventListener('click', e => {
        e.stopPropagation();
        post({ type: 'deleteSession', sessionId: row.id });
      });
      item.append(title, time, del);
      item.addEventListener('click', () => {
        post({ type: 'switchSession', sessionId: row.id });
        setOpen(false);
      });
      dropdown.appendChild(item);
    }
  };

  return store.subscribe(render);
}

function formatRel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h';
  return Math.floor(diff / 86_400_000) + 'd';
}
