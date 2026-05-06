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

export function mountToolPart(el: HTMLElement, part: ToolPartShape): void {
  const status = part.state.status;
  const dur = part.state.time?.start && part.state.time?.end
    ? ((part.state.time.end - part.state.time.start) / 1000).toFixed(1) + 's' : '';
  const symbol = status === 'completed' ? '✓' : status === 'error' ? '✕' : '●';
  el.className = 'tool-card';
  el.innerHTML = `
    <div class="tool-head">
      <span>${symbol}</span>
      <span class="tool-name" style="font-family:var(--vscode-editor-font-family);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <span style="opacity:0.6">${dur}</span>
    </div>
    <div class="tool-body"></div>
  `;
  (el.querySelector('.tool-name') as HTMLElement).textContent = `${part.tool} ${argsSummary(part.state.input)}`;
  (el.querySelector('.tool-body') as HTMLElement).textContent = part.state.output ?? '';
}

function argsSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  if (typeof o.command === 'string') return o.command;
  if (typeof o.file_path === 'string') return o.file_path;
  return JSON.stringify(o).slice(0, 80);
}
