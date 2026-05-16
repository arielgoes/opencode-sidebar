import type { EventToWebview, ModelOption } from '../sidebar/bridgeProtocol';
import type { Part } from '../opencode/types';

export interface SessionRow { id: string; title: string; updatedAt: number; }
export interface PendingPermission {
  id: string; sessionId: string; messageId: string; title: string;
  metadata: Record<string, unknown>; pattern?: string | string[];
}

export interface State {
  sessions: SessionRow[];
  activeSessionId: string | null;
  partsByMessage: Map<string, Part[]>;
  messageIdsBySession: Map<string, string[]>;
  messageRoles: Map<string, 'user' | 'assistant'>;
  pendingPermission: PendingPermission | null;
  composer: { text: string; model: string };
  availableModels: ModelOption[];
  status: 'idle' | 'streaming' | 'error' | 'reconnecting';
  sessionProcessing: boolean;
  processingSince: number | null;
  sessionRetry: string | null;
  sessionError: string | null;
  modelNotifications: Array<{ id: string; from: string | null; to: string }>;
  serverError: string | null;
  serverUrl: string;
  modelPickerOpen: boolean;
  lspCount: number;
  contextTokens: Map<string, number>;
}

export function initialState(): State {
  return {
    sessions: [], activeSessionId: null,
    partsByMessage: new Map(), messageIdsBySession: new Map(),
    messageRoles: new Map(),
    pendingPermission: null,
    composer: { text: '', model: '' },
    availableModels: [],
    status: 'idle', sessionProcessing: false, processingSince: null, sessionRetry: null, sessionError: null,
    modelNotifications: [], serverError: null, serverUrl: '', modelPickerOpen: false, lspCount: 0,
    contextTokens: new Map(),
  };
}

function closeStuckTools(state: State): State {
  const partsByMessage = new Map(state.partsByMessage);
  let changed = false;
  for (const [msgId, parts] of partsByMessage) {
    const next = parts.map(p => {
      if ((p as any).type !== 'tool') return p;
      const st = (p as any).state;
      if (st && (st.status === 'running' || st.status === 'pending')) {
        changed = true;
        return { ...p, state: { ...st, status: 'error', output: st.output || 'Tool timed out — server did not complete this call' } };
      }
      return p;
    });
    if (changed) { partsByMessage.set(msgId, next); changed = false; }
  }
  return { ...state, partsByMessage };
}

export function reduce(state: State, msg: EventToWebview): State {
  if (msg.type === 'ready') {
    return {
      ...state,
      sessions: msg.sessions,
      activeSessionId: msg.activeSessionId,
      composer: { ...state.composer, model: msg.defaultModel ?? '' },
      availableModels: msg.models ?? [],
      status: 'idle',
      lspCount: msg.lspCount ?? state.lspCount,
      serverUrl: msg.serverUrl ?? '',
    };
  }
  if (msg.type === 'serverStatus') {
    const status = msg.status === 'ready' ? 'idle'
      : msg.status === 'reconnecting' ? 'reconnecting' : 'error';
    return { ...state, status, serverError: msg.error ?? null };
  }
  if (msg.type === 'sessionMessages') {
    const partsByMessage = new Map(state.partsByMessage);
    const messageRoles = new Map(state.messageRoles);
    const messageIds: string[] = [];
    const contextTokens = new Map(state.contextTokens);
    let sessionTokens = 0;
    for (const m of msg.messages as Array<{ info: { id: string; role?: string }; parts: Array<{ type: string; tokens?: { input?: number } }> }>) {
      messageIds.push(m.info.id);
      partsByMessage.set(m.info.id, m.parts as any);
      if (m.info.role) messageRoles.set(m.info.id, m.info.role === 'user' ? 'user' : 'assistant');
      for (const part of m.parts) {
        if (part.type === 'step-finish' && part.tokens?.input) sessionTokens += part.tokens.input;
      }
    }
    contextTokens.set(msg.sessionId, sessionTokens);
    const messageIdsBySession = new Map(state.messageIdsBySession);
    messageIdsBySession.set(msg.sessionId, messageIds);
    return { ...state, partsByMessage, messageIdsBySession, messageRoles, activeSessionId: msg.sessionId, contextTokens };
  }
  if (msg.type === 'thinking') {
    return { ...state, sessionProcessing: true, processingSince: Date.now(), sessionRetry: null, sessionError: null };
  }
  if (msg.type === 'modelChanged') {
    const id = `mc-${Date.now()}`;
    return { ...state, modelNotifications: [...state.modelNotifications, { id, from: msg.from, to: msg.to }] };
  }
  if (msg.type === 'modelsRefreshed') {
    return { ...state, availableModels: msg.models, composer: { ...state.composer, model: state.composer.model || msg.defaultModel || '' } };
  }
  if (msg.type === 'sse') return reduceSse(state, msg.event);
  return state;
}

function reduceSse(state: State, e: { type: string; properties: unknown }): State {
  const p = e.properties as any;
  switch (e.type) {
    case 'session.created': {
      const info = p.info as { id: string; title: string; time: { updated: number } };
      const others = state.sessions.filter(s => s.id !== info.id);
      const sessions = [{ id: info.id, title: info.title, updatedAt: info.time.updated }, ...others];
      // Always switch to a newly created session
      return { ...state, sessions, activeSessionId: info.id };
    }
    case 'session.updated': {
      const info = p.info as { id: string; title: string; time: { updated: number } };
      const others = state.sessions.filter(s => s.id !== info.id);
      const sessions = [{ id: info.id, title: info.title, updatedAt: info.time.updated }, ...others];
      return { ...state, sessions, activeSessionId: state.activeSessionId ?? info.id };
    }
    case 'session.deleted': {
      const id = p.info.id as string;
      const sessions = state.sessions.filter(s => s.id !== id);
      const activeSessionId = state.activeSessionId === id ? (sessions[0]?.id ?? null) : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }
    case 'message.updated': {
      const info = p.info as { id: string; sessionID: string; role?: string };
      const ids = state.messageIdsBySession.get(info.sessionID) ?? [];
      if (ids.includes(info.id)) return state;
      const messageIdsBySession = new Map(state.messageIdsBySession);
      messageIdsBySession.set(info.sessionID, [...ids, info.id]);
      const partsByMessage = new Map(state.partsByMessage);
      if (!partsByMessage.has(info.id)) partsByMessage.set(info.id, []);
      const messageRoles = new Map(state.messageRoles);
      if (info.role) messageRoles.set(info.id, info.role === 'user' ? 'user' : 'assistant');
      return { ...state, messageIdsBySession, partsByMessage, messageRoles, status: 'streaming' };
    }
    case 'message.part.updated': {
      const part = p.part as Part & { messageID: string; id: string; type: string; tokens?: { input?: number } };
      const existing = state.partsByMessage.get(part.messageID) ?? [];
      const idx = existing.findIndex(q => (q as any).id === part.id);
      const next = idx >= 0 ? existing.map((q, i) => i === idx ? part : q) : [...existing, part];
      const partsByMessage = new Map(state.partsByMessage);
      partsByMessage.set(part.messageID, next);
      const contextTokens = new Map(state.contextTokens);
      if (part.type === 'step-finish' && part.tokens?.input) {
        const cur = contextTokens.get(part.sessionID) ?? 0;
        contextTokens.set(part.sessionID, cur + part.tokens.input);
      }
      return { ...state, partsByMessage, contextTokens };
    }
    case 'message.removed': {
      const { sessionID, messageID } = p as { sessionID: string; messageID: string };
      const ids = (state.messageIdsBySession.get(sessionID) ?? []).filter(x => x !== messageID);
      const messageIdsBySession = new Map(state.messageIdsBySession);
      messageIdsBySession.set(sessionID, ids);
      const partsByMessage = new Map(state.partsByMessage);
      partsByMessage.delete(messageID);
      const messageRoles = new Map(state.messageRoles);
      messageRoles.delete(messageID);
      return { ...state, messageIdsBySession, partsByMessage, messageRoles };
    }
    case 'permission.updated': {
      const perm = p as { id: string; sessionID: string; messageID: string; title: string; metadata: Record<string,unknown>; pattern?: string|string[] };
      console.log('[state] permission.updated', perm.id, perm.title, 'for session', perm.sessionID);
      return { ...state, pendingPermission: { id: perm.id, sessionId: perm.sessionID, messageId: perm.messageID, title: perm.title, metadata: perm.metadata, pattern: perm.pattern } };
    }
    case 'permission.replied': {
      console.log('[state] permission.replied', p.permissionID);
      if (state.pendingPermission?.id !== p.permissionID) return state;
      return { ...state, pendingPermission: null };
    }
    case 'session.idle':
    case 'session.compacted': {
      let s: State = { ...state, status: 'idle' as const, sessionProcessing: false, processingSince: null, sessionRetry: null };
      s = closeStuckTools(s);
      return s;
    }
    case 'session.status': {
      const sessionStatus = p.status as { type: string; message?: string; attempt?: number };
      if (sessionStatus.type === 'busy') {
        return { ...state, sessionProcessing: true, processingSince: state.processingSince ?? Date.now(), sessionRetry: null };
      }
      if (sessionStatus.type === 'idle') {
        let s: State = { ...state, sessionProcessing: false, processingSince: null, sessionRetry: null };
        s = closeStuckTools(s);
        return s;
      }
      if (sessionStatus.type === 'retry') {
        if (state.sessionError) return state;
        return { ...state, sessionProcessing: true, processingSince: state.processingSince ?? Date.now(), sessionRetry: sessionStatus.message ?? `Retrying (attempt ${sessionStatus.attempt ?? '?'})…` };
      }
      return state;
    }
    case 'session.error': {
      if (state.sessionError) return state;
      const err = (p as any).error;
      const msg = err?.data?.message ?? err?.message ?? err?.name
        ?? (typeof err === 'string' ? err : null)
        ?? 'Model returned an error — check Output → OpenCode for details';
      return { ...state, sessionProcessing: false, processingSince: null, sessionRetry: null, sessionError: msg };
    }
    case 'lsp.updated': {
      const servers = (p as any).servers ?? {};
      return { ...state, lspCount: Object.keys(servers).length };
    }
    default:
      return state;
  }
}

export type Listener = (state: State) => void;

export class Store {
  private state = initialState();
  private listeners = new Set<Listener>();
  get(): State { return this.state; }
  dispatch(msg: EventToWebview): void {
    const next = reduce(this.state, msg);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach(l => l(this.state));
    }
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => { this.listeners.delete(l); };
  }
}
