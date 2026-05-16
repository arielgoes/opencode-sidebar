interface ToolState {
  status: 'pending' | 'running' | 'completed' | 'error';
  input?: unknown;
  output?: string;
  time?: { start?: number; end?: number };
}

interface ToolPartShape {
  id: string;
  type: 'tool';
  tool: string;
  state: ToolState;
}

interface ToolPartDeps {
  sessionId: string;
  post: (m: any) => void;
}

export function mountToolPart(el: HTMLElement, part: ToolPartShape, deps?: ToolPartDeps): void {
  const status = part.state.status;
  const dur = part.state.time?.start && part.state.time?.end
    ? ((part.state.time.end - part.state.time.start) / 1000).toFixed(1) + 's' : '';
  const symbol = status === 'completed' ? '✓' : status === 'error' ? '✕' : '●';
  const rawOutput = part.state.output ?? '';
  const hasOutput = rawOutput.trim().length > 0;
  const isActive = status === 'running' || status === 'pending';
  const isError = status === 'error';

  // Detect hung tools: running for >60s with no output
  const runningSec = (isActive && part.state.time?.start)
    ? Math.floor((Date.now() - part.state.time.start) / 1000)
    : 0;
  const isHung = isActive && runningSec > 60;

  el.className = 'tool-card'
    + (isHung ? ' tool-card-hung' : '')
    + (isActive && !isHung ? ' tool-card-running' : '')
    + (isError ? ' tool-card-error' : '')
    + (status === 'completed' ? ' tool-card-done' : '');

  const bodyText = hasOutput ? rawOutput.trim()
    : isHung ? `Stuck (${runningSec}s) — no response from tool`
    : isActive ? 'Running…'
    : isError ? 'Error'
    : 'Completed';
  const showStop = (isActive || isHung) && deps;
  el.innerHTML = `
    <div class="tool-head">
      <span class="tool-status ${isHung ? 'hung' : status}">${isHung ? '⚠' : symbol}</span>
      <span class="tool-name" style="font-family:var(--vscode-editor-font-family);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      ${showStop ? '<button class="tool-stop-btn" title="Stop session">&#9632;</button>' : ''}
      <span class="tool-duration">${dur}</span>
    </div>
    <div class="tool-body">${escapeHtml(bodyText)}</div>
  `;
  (el.querySelector('.tool-name') as HTMLElement).textContent = `${part.tool} ${argsSummary(part.state.input)}`;
  if (showStop) {
    const btn = el.querySelector('.tool-stop-btn') as HTMLButtonElement;
    if (btn && deps) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deps.post({ type: 'stop', sessionId: deps.sessionId });
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function argsSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  if (typeof o.command === 'string') return o.command;
  if (typeof o.file_path === 'string') return o.file_path;
  return JSON.stringify(o).slice(0, 80);
}
