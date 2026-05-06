import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { mountModelPicker } from './ModelPicker';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

export function mountComposer(parent: HTMLElement, { store, post }: Deps): () => void {
  parent.innerHTML = `
    <textarea rows="2" placeholder="Ask opencode..."></textarea>
    <div class="row">
      <div class="model-picker-container"></div>
      <button class="btn btn-secondary stop-btn" title="Stop" style="display:none;padding:4px 8px;">■</button>
      <button class="btn btn-primary send-btn">Send</button>
    </div>
  `;

  const ta = parent.querySelector('textarea') as HTMLTextAreaElement;
  const sendBtn = parent.querySelector('.send-btn') as HTMLButtonElement;
  const stopBtn = parent.querySelector('.stop-btn') as HTMLButtonElement;
  const pickerContainer = parent.querySelector('.model-picker-container') as HTMLElement;

  const { cleanup: pickerCleanup } = mountModelPicker(pickerContainer, { store, post });

  const send = () => {
    const s = store.get();
    if (!s.activeSessionId) return;
    const text = ta.value.trim();
    if (!text) return;
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
  };

  const storeCleanup = store.subscribe(render);
  return () => { storeCleanup(); pickerCleanup(); };
}
