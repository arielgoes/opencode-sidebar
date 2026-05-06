import type { Event } from './types';
import type { OpencodeClient } from '@opencode-ai/sdk';

export interface EventStreamHandle { close(): void; }

export interface OpenedStream {
  on(event: 'event', handler: (e: Event) => void): unknown;
  on(event: 'error', handler: (err: unknown) => void): unknown;
  on(event: 'close', handler: () => void): unknown;
  abort(): void;
}

export interface ConnectOptions {
  open: () => Promise<OpenedStream>;
  onEvent: (e: Event) => void;
  onError: (err: unknown) => void;
  onReconnect: (attempt: number) => void;
  backoffMs?: (attempt: number) => number;
}

const defaultBackoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));

export function connectEventStream(opts: ConnectOptions): EventStreamHandle {
  const backoff = opts.backoffMs ?? defaultBackoff;
  let stopped = false;
  let attempt = 0;
  let current: OpenedStream | undefined;

  const dial = async () => {
    if (stopped) return;
    try {
      const stream = await opts.open();
      if (stopped) { stream.abort(); return; }
      current = stream;
      attempt = 0;
      stream.on('event', e => opts.onEvent(e));
      stream.on('error', err => { opts.onError(err); scheduleReconnect(); });
      stream.on('close', () => { scheduleReconnect(); });
    } catch (err) {
      opts.onError(err);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    attempt++;
    const delay = backoff(attempt);
    opts.onReconnect(attempt);
    setTimeout(dial, delay);
  };

  void dial();

  return {
    close() {
      stopped = true;
      try { current?.abort(); } catch {}
    },
  };
}

/**
 * Adapts the SDK's `client.event.subscribe()` (which returns a
 * `ServerSentEventsResult` whose `.stream` is an `AsyncGenerator`) into the
 * `OpenedStream` interface expected by `connectEventStream`.
 *
 * `EventSubscribeResponses = { 200: Event }`, so the generator yields `Event`
 * values directly.
 */
export async function openSdkEventStream(client: OpencodeClient): Promise<OpenedStream> {
  const result = await client.event.subscribe();

  // The SDK does not surface a top-level error property on the SSE result —
  // errors are delivered through the generator. If the subscribe() call itself
  // throws, the caller's try/catch in dial() will catch it.
  const gen = result.stream;

  type Handler<T> = (arg: T) => void;

  const eventHandlers: Handler<Event>[] = [];
  const errorHandlers: Handler<unknown>[] = [];
  const closeHandlers: Handler<void>[] = [];

  let aborted = false;
  const abortController = new AbortController();

  // Drive the async generator in the background.
  (async () => {
    try {
      for await (const item of gen) {
        if (aborted) break;
        // item is EventSubscribeResponses[keyof EventSubscribeResponses] = Event
        for (const h of eventHandlers) h(item as unknown as Event);
      }
      // Generator exhausted cleanly → treat as close.
      if (!aborted) {
        for (const h of closeHandlers) h();
      }
    } catch (err) {
      if (!aborted) {
        for (const h of errorHandlers) h(err);
      }
    }
  })();

  return {
    on(event: 'event' | 'error' | 'close', handler: (arg: never) => void): unknown {
      if (event === 'event') { eventHandlers.push(handler as Handler<Event>); }
      else if (event === 'error') { errorHandlers.push(handler as Handler<unknown>); }
      else if (event === 'close') { closeHandlers.push(handler as Handler<void>); }
      return undefined;
    },
    abort() {
      aborted = true;
      abortController.abort();
      // Best-effort: ask the generator to return early.
      gen.return(undefined).catch(() => {});
    },
  };
}
