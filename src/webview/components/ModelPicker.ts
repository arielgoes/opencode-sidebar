import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { groupModels } from './modelPickerUtil';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

function fmtTokens(n?: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function mountModelPicker(parent: HTMLElement, { store, post }: Deps): { cleanup: () => void; } {
  parent.innerHTML = `
    <button class="model-trigger" title="Select model"><span class="model-trigger-label"></span><span class="model-trigger-chevron">&#9662;</span></button>
    <div class="model-picker-panel">
      <div class="model-picker-topbar">
        <input type="text" class="model-picker-search" placeholder="Search models" />
        <button class="icon-btn model-picker-settings" title="Settings">&#9881;</button>
      </div>
      <div class="model-picker-body"></div>
    </div>
    <span class="model-stats" title="LSP servers connected"></span>
  `;

  const trigger = parent.querySelector('.model-trigger') as HTMLButtonElement;
  const triggerLabel = parent.querySelector('.model-trigger-label') as HTMLElement;
  const panel = parent.querySelector('.model-picker-panel') as HTMLElement;
  const body = parent.querySelector('.model-picker-body') as HTMLElement;
  const search = parent.querySelector('.model-picker-search') as HTMLInputElement;
  const statsEl = parent.querySelector('.model-stats') as HTMLElement;

  let open = false;
  let filter = '';

  const render = () => {
    const s = store.get();
    panel.classList.toggle('open', open);

    const selected = s.availableModels.find(m => m.id === s.composer.model);
    triggerLabel.textContent = selected?.label ?? s.composer.model ?? '(default)';

    const maxCtx = selected?.contextLimit;
    const usedCtx = s.contextTokens.get(s.activeSessionId ?? '') ?? 0;
    const maxStr = fmtTokens(maxCtx);
    const usedStr = usedCtx > 0 ? fmtTokens(usedCtx) : '';

    statsEl.innerHTML = '';
    if (maxCtx && maxCtx > 0) {
      const pct = Math.min(100, Math.round((usedCtx / maxCtx) * 100));
      const bar = document.createElement('span');
      bar.className = 'ctx-bar';
      bar.innerHTML = `<span class="ctx-bar-fill" style="width:${pct}%"></span>`;
      statsEl.appendChild(bar);

      const label = document.createElement('span');
      label.className = 'ctx-label';
      label.textContent = usedCtx > 0 ? `${usedStr}/${maxStr} - ${pct}%` : maxStr;
      statsEl.appendChild(label);
    }

    if (s.lspCount > 0) {
      if (statsEl.childNodes.length > 0) statsEl.append(' ');
      const l = document.createElement('span');
      l.className = 'lsp-label';
      l.textContent = `LSP:${s.lspCount}`;
      statsEl.appendChild(l);
    }

    const groups = groupModels(s.availableModels);
    const filtered = filter
      ? groups.map(g => ({ ...g, models: g.models.filter(m => m.label.toLowerCase().includes(filter.toLowerCase())) }))
                .filter(g => g.models.length > 0)
      : groups;

    if (filtered.length === 0 && s.availableModels.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no models available</div>';
      return;
    }
    if (filtered.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no matching models</div>';
      return;
    }

    let html = '';
    for (const g of filtered) {
      html += `<div class="model-picker-group" data-provider="${g.provider}">`;
      html += `<div class="model-picker-group-label">${g.label}</div>`;
      for (const m of g.models) {
        const active = m.id === s.composer.model;
        const ctxInfo = m.contextLimit ? ` — ${fmtTokens(m.contextLimit)} ctx` : '';
        html += `<div class="model-row" data-model-id="${m.id}">`;
        html += `<span class="model-label">${m.label}<span class="model-ctx-info">${ctxInfo}</span></span>`;
        if (active) html += `<span class="check">&#10003;</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  };

  trigger.addEventListener('click', () => { open = !open; render(); });

  search.addEventListener('input', () => {
    filter = search.value;
    render();
  });

  body.addEventListener('click', (e: Event) => {
    const row = (e.target as HTMLElement).closest('.model-row') as HTMLElement | null;
    if (!row) return;
    const modelId = row.dataset.modelId;
    if (!modelId) return;
    const s = store.get();
    store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: modelId, models: s.availableModels, directory: '', lspCount: s.lspCount });
    open = false;
    render();
  });

  const cleanup = store.subscribe(render);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      open = false;
      render();
    }
  };
  window.addEventListener('keydown', onKeydown);

  const onClickOutside = (e: MouseEvent) => {
    if (open && !parent.contains(e.target as Node)) {
      open = false;
      render();
    }
  };
  document.addEventListener('click', onClickOutside);

  const fullCleanup = () => { cleanup(); window.removeEventListener('keydown', onKeydown); document.removeEventListener('click', onClickOutside); };

  return { cleanup: fullCleanup };
}
