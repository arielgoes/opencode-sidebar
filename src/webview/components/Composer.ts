import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { mountModelPicker } from './ModelPicker';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountComposer(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.innerHTML = `
    <div class="model-change-bar"></div>
    <div class="input-container">
      <textarea rows="2" placeholder="Ask opencode..."></textarea>
      <div class="input-buttons">
        <button class="shortcut-button settings-btn" title="Manage API keys">⚙</button>
        <div class="model-picker-container"></div>
        <button class="shortcut-button stop-btn" title="Stop" style="display:none;">■</button>
        <button class="shortcut-button send-btn" title="Send (Enter)">Send ↵</button>
      </div>
    </div>
    <div class="server-url"></div>
  `;

  const ta = parent.querySelector('textarea') as HTMLTextAreaElement;
  const sendBtn = parent.querySelector('.send-btn') as HTMLButtonElement;
  const stopBtn = parent.querySelector('.stop-btn') as HTMLButtonElement;
  const settingsBtn = parent.querySelector('.settings-btn') as HTMLButtonElement;
  const pickerContainer = parent.querySelector('.model-picker-container') as HTMLElement;
  const serverUrlEl = parent.querySelector('.server-url') as HTMLElement;
  const changeBar = parent.querySelector('.model-change-bar') as HTMLElement;

  const { cleanup: pickerCleanup } = mountModelPicker(pickerContainer, { store, post });

  settingsBtn.addEventListener('click', () => post({ type: 'manageProviderKeys' }));

  const send = () => {
    const s = store.get();
    if (!s.activeSessionId) return;
    const text = ta.value.trim();
    if (!text) return;
    // Stop any in-progress request before sending new one
    if (s.status === 'streaming') post({ type: 'stop', sessionId: s.activeSessionId });
    const model = s.composer.model || undefined;
    post({ type: 'send', sessionId: s.activeSessionId, text, model });
    ta.value = '';
  };
  const stop = () => {
    const s = store.get();
    if (s.activeSessionId) post({ type: 'stop', sessionId: s.activeSessionId });
  };

  ta.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(130, ta.scrollHeight) + 'px';
  });

  const render = () => {
    const s = store.get();
    const streaming = s.status === 'streaming';
    stopBtn.style.display = streaming ? 'inline-block' : 'none';
    stopBtn.onclick = stop;
    sendBtn.onclick = send;
    serverUrlEl.textContent = s.serverUrl ? `→ ${s.serverUrl}` : '';
    const lastNotif = s.modelNotifications.length > 0 ? s.modelNotifications[s.modelNotifications.length - 1] : null;
    if (lastNotif) {
      changeBar.textContent = lastNotif.from
        ? `Switched from ${lastNotif.from} → ${lastNotif.to}`
        : `Using ${lastNotif.to}`;
      changeBar.style.display = 'block';
    } else {
      changeBar.style.display = 'none';
    }
  };

  const storeCleanup = store.subscribe(render);
  return () => { storeCleanup(); pickerCleanup(); };
}
