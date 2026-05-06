import { Store } from './state';
import { mountHeader } from './components/Header';
import { mountSessionList } from './components/SessionList';
import { mountMessageList } from './components/MessageList';
import { mountComposer } from './components/Composer';
import { initHighlighter } from './highlight';
import type { EventFromWebview, EventToWebview } from '../sidebar/bridgeProtocol';

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };

const vscode = acquireVsCodeApi();
const store = new Store();
const post = (m: EventFromWebview) => vscode.postMessage(m);

// Init Shiki in the background; components re-render when new messages arrive
initHighlighter().catch(() => {/* highlight degrades gracefully if Shiki fails */});

const root = document.getElementById('root')!;
root.innerHTML = `
  <div class="header"></div>
  <div class="session-list"></div>
  <div id="banner" class="banner" style="display:none;"></div>
  <div class="messages"></div>
  <div class="composer"></div>
`;

mountHeader(root.querySelector('.header')!, { post });
mountSessionList(root.querySelector('.session-list')!, { store, post });
mountMessageList(root.querySelector('.messages')!, { store, post });
mountComposer(root.querySelector('.composer')!, { store, post });

const banner = root.querySelector('#banner') as HTMLElement;
store.subscribe(s => {
  if (s.status === 'reconnecting') {
    banner.textContent = 'Reconnecting…';
    banner.style.display = 'block';
  } else if (s.status === 'error') {
    banner.innerHTML = '';
    banner.append(`Server error: ${s.serverError ?? 'unknown'} — `);
    const a = document.createElement('a');
    a.textContent = 'Retry';
    a.href = '#';
    a.onclick = e => { e.preventDefault(); post({ type: 'restartServer' }); };
    banner.append(a);
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
});

window.addEventListener('message', (ev: MessageEvent<EventToWebview>) => {
  store.dispatch(ev.data);
});

post({ type: 'ready' });
