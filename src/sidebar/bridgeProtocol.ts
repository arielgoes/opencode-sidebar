import type { Event } from '../opencode/types';

export interface SessionSummary { id: string; title: string; updatedAt: number; }

export interface ModelOption { id: string; label: string; contextLimit?: number; }

export type EventToWebview =
  | { type: 'ready'; sessions: SessionSummary[]; activeSessionId: string | null; defaultModel: string | null; models: ModelOption[]; directory: string; lspCount: number }
  | { type: 'modelChanged'; from: string | null; to: string }
  | { type: 'sse'; event: Event }
  | { type: 'sessionMessages'; sessionId: string; messages: Array<{ info: unknown; parts: unknown[] }> }
  | { type: 'serverStatus'; status: 'starting' | 'ready' | 'reconnecting' | 'error'; error?: string }
  | { type: 'thinking'; sessionId: string }
  | { type: 'error'; message: string };

export type EventFromWebview =
  | { type: 'ready' }
  | { type: 'send'; sessionId: string; text: string; model?: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'permissionReply'; sessionId: string; permissionId: string; decision: import('../opencode/types').PermissionDecision }
  | { type: 'restartServer' }
  | { type: 'addProviderKey' }
  | { type: 'manageProviderKeys' };
