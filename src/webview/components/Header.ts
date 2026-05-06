import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
interface Deps { post: (m: EventFromWebview) => void; }
export function mountHeader(parent: HTMLElement, { post }: Deps): () => void {
  parent.innerHTML = `
    <h1>OpenCode</h1>
    <button class="icon-btn" title="Add provider API key" data-action="key" style="font-size:12px;">🔑</button>
    <button class="icon-btn" title="New session" data-action="new">+</button>
    <button class="icon-btn" title="Restart server" data-action="restart">⟳</button>
  `;
  parent.querySelector('[data-action=key]')!.addEventListener('click', () => post({ type: 'manageProviderKeys' }));
  parent.querySelector('[data-action=new]')!.addEventListener('click', () => post({ type: 'newSession' }));
  parent.querySelector('[data-action=restart]')!.addEventListener('click', () => post({ type: 'restartServer' }));
  return () => {};
}
