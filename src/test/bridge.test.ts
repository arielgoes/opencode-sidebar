import { describe, it, expect, vi } from 'vitest';
import { MessageBridge } from '../sidebar/messageBridge';

function fakeApi() {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'new-session' }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] }),
    renameSession: vi.fn().mockResolvedValue(undefined),
    raw: { lsp: { status: vi.fn().mockResolvedValue({ data: [] }) } } as any,
  };
}

describe('MessageBridge', () => {
  it('on `ready` posts back sessions and messages for first session', async () => {
    const api = fakeApi();
    api.listSessions.mockResolvedValue([{ id: 's1', title: 'T', time: { updated: 5 } }]);
    api.listMessages.mockResolvedValue([{ info: { id: 'm1' }, parts: [{ type: 'text', text: 'hi' }] }]);
    api.listProviders.mockResolvedValue({ all: [{ id: 'anthropic', models: { 'claude': {} } }], default: {}, connected: ['anthropic'] });
    const posts: unknown[] = [];
    const bridge = new MessageBridge({ api, post: m => posts.push(m), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'ready' });
    const readyMsg = posts.find((p: any) => p.type === 'ready') as any;
    expect(readyMsg).toBeDefined();
    expect(readyMsg.sessions[0].id).toBe('s1');
    const msgsMsg = posts.find((p: any) => p.type === 'sessionMessages') as any;
    expect(msgsMsg).toBeDefined();
    expect(msgsMsg.sessionId).toBe('s1');
  });

  it('on `send` calls api.sendPrompt with text part and parsed model', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'send', sessionId: 's1', text: 'hi', model: 'anthropic/claude' });
    expect(api.sendPrompt).toHaveBeenCalledWith(
      's1',
      [{ type: 'text', text: 'hi' }],
      { providerID: 'anthropic', modelID: 'claude' },
    );
  });

  it('on `send` with no model calls sendPrompt without model arg', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'send', sessionId: 's1', text: 'hello' });
    expect(api.sendPrompt).toHaveBeenCalledWith('s1', [{ type: 'text', text: 'hello' }], undefined);
  });

  it('on `stop` calls api.abort', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'stop', sessionId: 's1' });
    expect(api.abort).toHaveBeenCalledWith('s1');
  });

  it('on `permissionReply` forwards decision', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'permissionReply', sessionId: 's1', permissionId: 'p1', decision: 'once' });
    expect(api.replyPermission).toHaveBeenCalledWith('s1', 'p1', 'once');
  });

  it('on `deleteSession` calls api.deleteSession', async () => {
    const api = fakeApi();
    const bridge = new MessageBridge({ api, post: vi.fn(), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'deleteSession', sessionId: 's1' });
    expect(api.deleteSession).toHaveBeenCalledWith('s1');
  });

  it('posts an error message when api throws', async () => {
    const api = fakeApi();
    api.abort.mockRejectedValue(new Error('network error'));
    const posts: unknown[] = [];
    const bridge = new MessageBridge({ api, post: m => posts.push(m), onRestartServer: vi.fn(), serverUrl: 'http://localhost:4096', directory: '' });
    await bridge.handle({ type: 'stop', sessionId: 's1' });
    expect(posts[0]).toMatchObject({ type: 'error', message: 'network error' });
  });
});
