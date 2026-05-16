import type { ApiClient } from '../opencode/apiClient';
import type { EventFromWebview, EventToWebview, SessionSummary } from './bridgeProtocol';
import type { TextPartInput } from '../opencode/types';

export interface BridgeOptions {
  api: ApiClient;
  post: (msg: EventToWebview) => void;
  onRestartServer: () => void;
  directory: string;
  serverUrl: string;
}

export class MessageBridge {
  private lastModel: string | null = null;
  constructor(private opts: BridgeOptions) {}

  async handle(msg: EventFromWebview): Promise<void> {
    const { api, post, onRestartServer } = this.opts;
    try {
      switch (msg.type) {
        case 'ready': {
          const [sessions, providers] = await Promise.all([api.listSessions(), api.listProviders()]);
          const list: SessionSummary[] = (sessions as any[]).map(s => ({
            id: s.id, title: s.title || '(untitled)', updatedAt: s.time?.updated ?? 0,
          }));
          const { defaultModel, models } = buildModelList(providers);
          let lspCount = 0;
          try { const lsp = await api.raw.lsp.status(); lspCount = (lsp.data as any[]).length; } catch { /* ignore */ }
          post({ type: 'ready', sessions: list, activeSessionId: list[0]?.id ?? null, defaultModel, models, directory: this.opts.directory, lspCount, serverUrl: this.opts.serverUrl });
          if (list[0]) {
            const messages = await api.listMessages(list[0].id);
            post({ type: 'sessionMessages', sessionId: list[0].id, messages: messages as any });
          }
          break;
        }
        case 'send': {
          const modelLabel = msg.model ?? null;
          if (modelLabel !== this.lastModel) {
            post({ type: 'modelChanged', from: this.lastModel, to: modelLabel ?? '(default)' });
            this.lastModel = modelLabel;
          }
          const model = parseModel(msg.model);
          const part: TextPartInput = { type: 'text', text: msg.text };
          post({ type: 'thinking', sessionId: msg.sessionId });
          await api.sendPrompt(msg.sessionId, [part], model);
          break;
        }
        case 'stop':         await api.abort(msg.sessionId); break;
        case 'newSession':   await api.createSession(); break;
        case 'switchSession': {
          const messages = await api.listMessages(msg.sessionId);
          post({ type: 'sessionMessages', sessionId: msg.sessionId, messages: messages as any });
          break;
        }
        case 'deleteSession':  await api.deleteSession(msg.sessionId); break;
        case 'renameSession':  await api.renameSession(msg.sessionId, msg.title); break;
        case 'permissionReply': await api.replyPermission(msg.sessionId, msg.permissionId, msg.decision); break;
        case 'restartServer':  onRestartServer(); break;
        case 'fetchModels': {
          const providers = await api.listProviders();
          const { defaultModel, models } = buildModelList(providers);
          // Send updated models while preserving current session state
          post({ type: 'modelsRefreshed', models, defaultModel });
          break;
        }
      }
    } catch (err: unknown) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

function parseModel(raw?: string): { providerID: string; modelID: string } | undefined {
  if (!raw) return undefined;
  const ix = raw.indexOf('/');
  return ix < 1 ? undefined : { providerID: raw.slice(0, ix), modelID: raw.slice(ix + 1) };
}

function buildModelList(providers: unknown): { defaultModel: string | null; models: Array<{ id: string; label: string; contextLimit?: number }> } {
  const data = providers as any;
  const all: any[] = data?.all ?? [];
  const connected: string[] = data?.connected ?? [];
  const defaults: Record<string, string> = data?.default ?? {};

  const models: Array<{ id: string; label: string; contextLimit?: number }> = [];
  for (const p of all) {
    if (!connected.includes(p.id)) continue;
    for (const modelId of Object.keys(p.models ?? {})) {
      const m = p.models[modelId];
      models.push({ id: `${p.id}/${modelId}`, label: `${p.id} / ${modelId}`, contextLimit: m?.limit?.context });
    }
  }

  // Pick first connected provider's default model
  let defaultModel: string | null = null;
  for (const provId of connected) {
    const modelId = defaults[provId];
    if (modelId) { defaultModel = `${provId}/${modelId}`; break; }
  }
  // Fallback to first model in list
  if (!defaultModel && models.length > 0) defaultModel = models[0].id;

  return { defaultModel, models };
}
