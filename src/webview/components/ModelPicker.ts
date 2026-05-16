import type { Store } from '../state';
import type { EventFromWebview } from '../../sidebar/bridgeProtocol';
import { groupModels, PROVIDER_LABELS } from './modelPickerUtil';

interface Deps { store: Store; post: (m: EventFromWebview) => void; }

const PROVIDER_ICONS: Record<string, string> = {
  opencode: '◈', 'opencode-go': '◈', openai: '✦', anthropic: '◆', google: '⬡', groq: '◈',
  mistral: '✦', xai: '⬡', deepseek: '◈', minimax: '◆', openrouter: '◎',
  'zai-coding-plan': '◈', 'nano-gpt': '◎',
};

const PROVIDER_COLORS: Record<string, string> = {
  opencode: '#48a0c7', 'opencode-go': '#48a0c7', openai: '#74aa9c', anthropic: '#d97757',
  google: '#5b9cf5', mistral: '#f7a700', deepseek: '#4d6bfe', groq: '#f55036',
  xai: '#111', openrouter: '#6366f1', minimax: '#8b5cf6',
  'zai-coding-plan': '#48a0c7', 'nano-gpt': '#6366f1',
};

function fmtTokens(n?: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function circumference(r: number): number { return 2 * Math.PI * r; }

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
    <div class="context-indicator" title="Click for session stats">
      <svg class="ctx-wheel" viewBox="0 0 36 36">
        <circle class="ctx-wheel-bg" cx="18" cy="18" r="14" />
        <circle class="ctx-wheel-fill" cx="18" cy="18" r="14" />
      </svg>
      <span class="ctx-pct"></span>
    </div>
    <div class="context-panel">
      <div class="context-panel-header">
        <span class="context-panel-title">Context</span>
        <button class="context-panel-close" title="Close">&#10005;</button>
      </div>
      <div class="context-panel-body"></div>
    </div>
    <span class="model-stats" title="LSP servers connected"></span>
  `;

  const trigger = parent.querySelector('.model-trigger') as HTMLButtonElement;
  const triggerLabel = parent.querySelector('.model-trigger-label') as HTMLElement;
  const panel = parent.querySelector('.model-picker-panel') as HTMLElement;
  const body = parent.querySelector('.model-picker-body') as HTMLElement;
  const search = parent.querySelector('.model-picker-search') as HTMLInputElement;
  const statsEl = parent.querySelector('.model-stats') as HTMLElement;
  const ctxIndicator = parent.querySelector('.context-indicator') as HTMLElement;
  const ctxWheelFill = parent.querySelector('.ctx-wheel-fill') as SVGCircleElement;
  const ctxPct = parent.querySelector('.ctx-pct') as HTMLElement;
  const ctxPanel = parent.querySelector('.context-panel') as HTMLElement;
  const ctxPanelBody = parent.querySelector('.context-panel-body') as HTMLElement;
  const ctxPanelClose = parent.querySelector('.context-panel-close') as HTMLButtonElement;

  let open = false;
  let filter = '';
  let ctxPanelOpen = false;

  const renderContextPanel = () => {
    const s = store.get();
    const selected = s.availableModels.find(m => m.id === s.composer.model);
    const maxCtx = selected?.contextLimit ?? 0;
    const usedCtx = s.contextTokens.get(s.activeSessionId ?? '') ?? 0;
    const pct = maxCtx > 0 ? Math.min(100, Math.round((usedCtx / maxCtx) * 100)) : 0;
    const msgCount = (s.messageIdsBySession.get(s.activeSessionId ?? '') ?? []).length;
    const userMsgs = (s.messageIdsBySession.get(s.activeSessionId ?? '') ?? []).filter(id => s.messageRoles.get(id) === 'user').length;
    const assistantMsgs = msgCount - userMsgs;
    const active = s.sessions.find(sess => sess.id === s.activeSessionId);

    ctxPanelBody.innerHTML = `
      <div class="ctx-stats-grid">
        <div class="ctx-stat"><span class="ctx-stat-label">Session</span><span class="ctx-stat-value">${active?.title ?? '—'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Model</span><span class="ctx-stat-value">${selected?.label ?? '—'}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Context Limit</span><span class="ctx-stat-value">${fmtTokens(maxCtx)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Total Tokens</span><span class="ctx-stat-value">${fmtTokens(usedCtx)}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Usage</span><span class="ctx-stat-value ${pct > 80 ? 'ctx-warn' : ''}">${pct}%</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Messages</span><span class="ctx-stat-value">${msgCount}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">User Messages</span><span class="ctx-stat-value">${userMsgs}</span></div>
        <div class="ctx-stat"><span class="ctx-stat-label">Assistant Messages</span><span class="ctx-stat-value">${assistantMsgs}</span></div>
      </div>
      <div class="ctx-breakdown-bar">
        <div class="ctx-breakdown-track">
          <div class="ctx-breakdown-fill" style="width:${pct}%"></div>
        </div>
        <div class="ctx-breakdown-legend">
          <span class="ctx-legend-item"><span class="ctx-legend-dot" style="background:var(--vscode-textLink-foreground)"></span>Used ${pct}%</span>
          <span class="ctx-legend-item"><span class="ctx-legend-dot" style="background:var(--vscode-input-border)"></span>Available ${100 - pct}%</span>
        </div>
      </div>
    `;
  };

  const render = () => {
    const s = store.get();
    panel.classList.toggle('open', open);

    const selected = s.availableModels.find(m => m.id === s.composer.model);
    triggerLabel.textContent = selected?.label ?? s.composer.model ?? 'Select model';

    const maxCtx = selected?.contextLimit;
    const usedCtx = s.contextTokens.get(s.activeSessionId ?? '') ?? 0;
    const pct = maxCtx && maxCtx > 0 ? Math.min(100, Math.round((usedCtx / maxCtx) * 100)) : 0;

    const r = 14;
    const circ = circumference(r);
    ctxWheelFill.style.strokeDasharray = `${circ}`;
    ctxWheelFill.style.strokeDashoffset = `${circ - (pct / 100) * circ}`;
    ctxPct.textContent = pct > 0 ? `${pct}%` : '';
    ctxIndicator.style.display = maxCtx && maxCtx > 0 ? 'flex' : 'none';

    if (s.lspCount > 0) {
      statsEl.innerHTML = `<span class="lsp-label">LSP:${s.lspCount}</span>`;
    } else {
      statsEl.innerHTML = '';
    }

    if (ctxPanelOpen) renderContextPanel();

    const groups = groupModels(s.availableModels);
    const filtered = filter
      ? groups.map(g => ({ ...g, models: g.models.filter(m => m.label.toLowerCase().includes(filter.toLowerCase())) }))
                .filter(g => g.models.length > 0)
      : groups;

    if (s.availableModels.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">loading models…</div>';
      return;
    }
    if (filtered.length === 0) {
      body.innerHTML = '<div class="model-picker-empty">no matching models</div>';
      return;
    }

    const activeModelId = s.composer.model;
    let html = '';
    for (const g of filtered) {
      const providerIcon = PROVIDER_ICONS[g.provider] ?? '⬡';
      const providerColor = PROVIDER_COLORS[g.provider] ?? '';
      html += `<div class="model-picker-group" data-provider="${g.provider}">`;
      html += `<div class="model-picker-group-header"><span class="model-picker-group-icon" style="${providerColor ? `color:${providerColor}` : ''}">${providerIcon}</span><span class="model-picker-group-label">${g.label}</span><span class="model-picker-group-count">${g.models.length}</span></div>`;
      for (const m of g.models) {
        const active = m.id === activeModelId;
        const ctxInfo = m.contextLimit ? `<span class="model-ctx-badge">${fmtTokens(m.contextLimit)} ctx</span>` : '';
        html += `<div class="model-row${active ? ' active' : ''}" data-model-id="${m.id}">`;
        html += `<div class="model-row-left"><span class="model-checkmark">${active ? '✓' : ''}</span><span class="model-label">${m.label.replace(new RegExp(`^${g.provider}\\s*/\\s*`), '')}</span></div>`;
        html += `<span class="model-row-right">${ctxInfo}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  };

  trigger.addEventListener('click', () => { 
    open = !open; 
    if (open) post({ type: 'fetchModels' });
    render(); 
  });

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
    // Stop any in-progress request when switching models
    if (s.status === 'streaming' && s.activeSessionId) {
      post({ type: 'stop', sessionId: s.activeSessionId });
    }
    store.dispatch({ type: 'ready', sessions: s.sessions, activeSessionId: s.activeSessionId, defaultModel: modelId, models: s.availableModels, directory: '', lspCount: s.lspCount, serverUrl: s.serverUrl });
    open = false;
    render();
  });

  ctxIndicator.addEventListener('click', () => {
    ctxPanelOpen = !ctxPanelOpen;
    ctxPanel.classList.toggle('open', ctxPanelOpen);
    if (ctxPanelOpen) renderContextPanel();
  });

  ctxPanelClose.addEventListener('click', () => {
    ctxPanelOpen = false;
    ctxPanel.classList.remove('open');
  });

  const cleanup = store.subscribe(render);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (ctxPanelOpen) { ctxPanelOpen = false; ctxPanel.classList.remove('open'); }
      else if (open) { open = false; render(); }
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
