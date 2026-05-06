import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from '../opencode/apiClient';

function fakeFetch(map: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const urlObj = new URL(u);
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${urlObj.pathname}`;
    const hit = map[key];
    if (!hit) throw new Error(`unmocked request: ${key}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('apiClient', () => {
  it('listSessions calls GET /session and returns the array', async () => {
    const fetch = fakeFetch({ 'GET /session': { body: [{ id: 's1', title: 'A' }] } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    const sessions = await api.listSessions();
    expect(sessions).toEqual([{ id: 's1', title: 'A' }]);
  });

  it('createSession posts to /session', async () => {
    const fetch = fakeFetch({ 'POST /session': { body: { id: 's-new', title: 'Hello' } } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    const created = await api.createSession('Hello');
    expect(created).toMatchObject({ id: 's-new' });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe('POST');
  });

  it('sendPrompt posts to /session/<id>/message with parts and model', async () => {
    const fetch = fakeFetch({ 'POST /session/s1/message': { body: { id: 'm1' } } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.sendPrompt('s1', [{ type: 'text', text: 'hi' } as any], { providerID: 'anthropic', modelID: 'claude' });
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      parts: [{ type: 'text', text: 'hi' }],
      model: { providerID: 'anthropic', modelID: 'claude' },
    });
  });

  it('abort posts to /session/<id>/abort', async () => {
    const fetch = fakeFetch({ 'POST /session/s1/abort': { body: true } });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.abort('s1');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
  });

  it('replyPermission maps allow→always, once→once, deny→reject', async () => {
    const fetch = fakeFetch({
      'POST /session/s1/permissions/p1': { body: true },
      'POST /session/s1/permissions/p2': { body: true },
      'POST /session/s1/permissions/p3': { body: true },
    });
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:1234', fetch });
    await api.replyPermission('s1', 'p1', 'allow');
    await api.replyPermission('s1', 'p2', 'once');
    await api.replyPermission('s1', 'p3', 'deny');
    const bodies = fetch.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies.map((b: any) => b.response)).toEqual(['always', 'once', 'reject']);
  });
});
