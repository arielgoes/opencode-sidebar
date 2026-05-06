import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';
import type {
  Session,
  Message,
  AssistantMessage,
  Part,
  TextPartInput,
  FilePartInput,
  AgentPartInput,
  SubtaskPartInput,
} from './types';
import { decisionToWire, type PermissionDecision } from './types';

type PromptPart = TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput;

/** A standard fetch-compatible function (url + init style). */
type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Base URL of the opencode server, e.g. "http://127.0.0.1:1234" */
  baseUrl: string;
  /** Workspace directory — passed to opencode so it uses the right project config. */
  directory?: string;
  /**
   * Optional fetch implementation. Useful for tests.
   * Accepts a standard (url, init?) fetch signature; internally adapted to
   * the SDK's (Request) => Response signature.
   */
  fetch?: FetchFn;
}

export type MessageEntry = { info: Message; parts: Part[] };
export type PromptResult = { info: AssistantMessage; parts: Part[] };

export interface ApiClient {
  listSessions(): Promise<Session[]>;
  createSession(title?: string): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  listMessages(sessionId: string): Promise<MessageEntry[]>;
  sendPrompt(
    sessionId: string,
    parts: PromptPart[],
    model?: { providerID: string; modelID: string }
  ): Promise<PromptResult>;
  abort(sessionId: string): Promise<void>;
  replyPermission(
    sessionId: string,
    permId: string,
    decision: PermissionDecision
  ): Promise<void>;
  listProviders(): Promise<unknown>;
  /** The underlying SDK client, for advanced use. */
  raw: OpencodeClient;
}

/** Unwrap an SDK `{ data, error }` response, throwing on error. */
function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined && result.error !== null) {
    throw result.error instanceof Error
      ? result.error
      : new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
  }
  if (result.data === undefined) {
    throw new Error('opencode SDK returned no data and no error');
  }
  return result.data;
}

/**
 * Adapt a standard `(url, init?) => Response` fetch function to the shape
 * that the SDK's Config.fetch expects: `(request: Request) => Response`.
 *
 * The SDK constructs a `Request` object whose body is a ReadableStream, so
 * we read it with `request.text()` before forwarding to the url+init-style fn.
 * Assumption: running in Electron / Node 20+ where `Request` is web-standard.
 */
function adaptFetch(fn: FetchFn): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const { url, method, headers } = request;
    const bodyText = request.body !== null ? await request.text() : undefined;
    return fn(url, { method, headers, body: bodyText });
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const raw = createOpencodeClient({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: adaptFetch(options.fetch) } : {}),
  });
  const dir = options.directory;

  return {
    raw,

    async listSessions() {
      // No directory filter — list all sessions across all workspaces
      return unwrap(await raw.session.list()) as Session[];
    },

    async createSession(title?: string) {
      return unwrap(await raw.session.create({
        body: title !== undefined ? { title } : undefined,
        query: dir ? { directory: dir } : undefined,
      })) as Session;
    },

    async deleteSession(id: string) {
      unwrap(await raw.session.delete({ path: { id } }));
    },

    async renameSession(id: string, title: string) {
      unwrap(await raw.session.update({ path: { id }, body: { title } }));
    },

    async listMessages(sessionId: string) {
      return unwrap(await raw.session.messages({ path: { id: sessionId } })) as MessageEntry[];
    },

    async sendPrompt(sessionId, parts, model?) {
      return unwrap(await raw.session.prompt({
        path: { id: sessionId },
        query: dir ? { directory: dir } : undefined,
        body: { parts, ...(model ? { model } : {}) },
      })) as PromptResult;
    },

    async abort(sessionId: string) {
      unwrap(await raw.session.abort({ path: { id: sessionId } }));
    },

    async replyPermission(sessionId, permId, decision) {
      unwrap(await raw.postSessionIdPermissionsPermissionId({
        path: { id: sessionId, permissionID: permId },
        body: { response: decisionToWire[decision] },
      }));
    },

    async listProviders() {
      return unwrap(await raw.provider.list());
    },
  };
}
