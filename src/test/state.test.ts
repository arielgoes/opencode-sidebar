import { describe, it, expect } from 'vitest';
import { initialState, reduce, Store } from '../webview/state';

describe('reduce', () => {
  it('starts empty', () => {
    const s = initialState();
    expect(s.sessions).toEqual([]);
    expect(s.activeSessionId).toBeNull();
    expect(s.pendingPermission).toBeNull();
    expect(s.status).toBe('idle');
  });

  it('initialState has modelPickerOpen false, lspCount 0, and empty contextTokens', () => {
    const s = initialState();
    expect(s.modelPickerOpen).toBe(false);
    expect(s.lspCount).toBe(0);
    expect(s.contextTokens.size).toBe(0);
  });

  it('sessionMessages accumulates tokens from step-finish parts', () => {
    let s = reduce(initialState(), { type: 'ready', sessions: [{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:null, models: [], directory: '', lspCount: 0, serverUrl: '' });
    s = reduce(s, { type: 'sessionMessages', sessionId:'s1', messages:[
      { info:{id:'m1',role:'user'}, parts:[] },
      { info:{id:'m2',role:'assistant'}, parts:[{type:'step-finish',tokens:{input:500}}] },
      { info:{id:'m3',role:'assistant'}, parts:[{type:'step-finish',tokens:{input:300}}] },
    ] });
    expect(s.contextTokens.get('s1')).toBe(800);
  });

  it('message.part.updated accumulates tokens from step-finish parts', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'A', time: { updated: 1 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1', role: 'assistant' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', sessionID: 's1', type: 'step-finish', tokens: { input: 200 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p2', messageID: 'm1', sessionID: 's1', type: 'step-finish', tokens: { input: 300 } } } } as any });
    expect(s.contextTokens.get('s1')).toBe(500);
  });

  it('ready sets sessions and selects first', () => {
    const s = reduce(initialState(), {
      type: 'ready', sessions: [{ id: 's1', title: 'A', updatedAt: 1 }], activeSessionId: 's1', defaultModel: 'anthropic/claude',
      models: [], directory: '', lspCount: 2, serverUrl: '',
    });
    expect(s.sessions.map(x => x.id)).toEqual(['s1']);
    expect(s.activeSessionId).toBe('s1');
    expect(s.composer.model).toBe('anthropic/claude');
    expect(s.lspCount).toBe(2);
    expect(s.sessions.map(x => x.id)).toEqual(['s1']);
    expect(s.activeSessionId).toBe('s1');
    expect(s.composer.model).toBe('anthropic/claude');
  });

  it('session.created appends a session and selects it if none active', () => {
    const s = reduce(initialState(), {
      type: 'sse',
      event: { type: 'session.created', properties: { info: { id: 's1', title: 'Hello', time: { updated: 5 } } } } as any,
    });
    expect(s.sessions.map(x => x.id)).toEqual(['s1']);
    expect(s.activeSessionId).toBe('s1');
  });

  it('message.updated creates an empty parts slot the first time', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'A', time: { updated: 1 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    expect(s.messageIdsBySession.get('s1')).toEqual(['m1']);
    expect(s.partsByMessage.get('m1')).toEqual([]);
    expect(s.status).toBe('streaming');
  });

  it('message.part.updated replaces parts by id on second chunk (not append)', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'A', time: { updated: 1 } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', type: 'text', text: 'hi there' } } } as any });
    const parts = s.partsByMessage.get('m1')!;
    expect(parts).toHaveLength(1);
    expect((parts[0] as any).text).toBe('hi there');
  });

  it('message.removed removes from session list and parts map', () => {
    let s = initialState();
    s = reduce(s, { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title:'A', time:{updated:1} } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.removed', properties: { sessionID: 's1', messageID: 'm1' } } as any });
    expect(s.messageIdsBySession.get('s1')).toEqual([]);
    expect(s.partsByMessage.has('m1')).toBe(false);
  });

  it('permission.updated sets pendingPermission; permission.replied clears it', () => {
    let s = initialState();
    s = reduce(s, { type: 'sse', event: { type: 'permission.updated', properties: { id: 'pp1', sessionID: 's1', messageID: 'm1', title: 'edit foo', metadata: {} } } as any });
    expect(s.pendingPermission?.id).toBe('pp1');
    s = reduce(s, { type: 'sse', event: { type: 'permission.replied', properties: { permissionID: 'pp1' } } as any });
    expect(s.pendingPermission).toBeNull();
  });

  it('session.deleted on the active session falls back to next session', () => {
    let s = reduce(initialState(), { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title:'A', time:{updated:1} } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'session.created', properties: { info: { id: 's2', title:'B', time:{updated:2} } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'session.deleted', properties: { info: { id: 's1' } } } as any });
    expect(s.activeSessionId).toBe('s2');
  });

  it('sessionMessages populates messageIdsBySession and partsByMessage', () => {
    let s = reduce(initialState(), { type: 'ready', sessions: [{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:null, models: [], directory: '', lspCount: 0, serverUrl: '' });
    s = reduce(s, { type: 'sessionMessages', sessionId:'s1', messages:[{ info:{id:'m1'}, parts:[{id:'p1',type:'text',text:'hello'}] }] });
    expect(s.messageIdsBySession.get('s1')).toEqual(['m1']);
    expect((s.partsByMessage.get('m1')![0] as any).text).toBe('hello');
  });

  it('session.idle closes stuck running tool parts', () => {
    let s = reduce(initialState(), { type: 'ready', sessions: [{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:null, models: [], directory: '', lspCount: 0, serverUrl: '' });
    s = reduce(s, { type: 'thinking', sessionId: 's1' });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1', role: 'assistant' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', sessionID: 's1', type: 'tool', tool: 'view', state: { status: 'running', input: { file_path: '/img.png' } } } } } as any });
    const toolPart = s.partsByMessage.get('m1')![0] as any;
    expect(toolPart.state.status).toBe('running');

    s = reduce(s, { type: 'sse', event: { type: 'session.idle', properties: {} } as any });
    const closedTool = s.partsByMessage.get('m1')![0] as any;
    expect(closedTool.state.status).toBe('error');
    expect(closedTool.state.output).toContain('timed out');
  });

  it('session.idle preserves completed tool parts', () => {
    let s = reduce(initialState(), { type: 'ready', sessions: [{id:'s1',title:'a',updatedAt:1}], activeSessionId:'s1', defaultModel:null, models: [], directory: '', lspCount: 0, serverUrl: '' });
    s = reduce(s, { type: 'sse', event: { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1', role: 'assistant' } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', sessionID: 's1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt' } } } } as any });
    s = reduce(s, { type: 'sse', event: { type: 'session.idle', properties: {} } as any });
    const toolPart = s.partsByMessage.get('m1')![0] as any;
    expect(toolPart.state.status).toBe('completed');
    expect(toolPart.state.output).toBe('file.txt');
  });
});

describe('Store', () => {
  it('notifies subscribers on dispatch', () => {
    const store = new Store();
    const seen: Array<string | null> = [];
    store.subscribe(s => seen.push(s.activeSessionId));
    store.dispatch({ type: 'sse', event: { type: 'session.created', properties: { info: { id: 's1', title: 'a', time: { updated: 1 } } } } as any });
    expect(seen).toEqual([null, 's1']);
  });
});
