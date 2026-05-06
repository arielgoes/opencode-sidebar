import { describe, it, expect, vi, afterEach } from 'vitest';
import { connectEventStream, type OpenedStream, type ConnectOptions } from '../opencode/sseClient';
import type { Event } from '../opencode/types';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake OpenedStream backed by a Node EventEmitter. */
function makeFakeStream(): OpenedStream & { emitter: EventEmitter } {
  const emitter = new EventEmitter();
  // Use a type assertion so we can satisfy the overloaded `on` signatures
  // without duplicating each overload in the test helper.
  const on = (event: string, handler: (...args: unknown[]) => void) => {
    emitter.on(event, handler);
    return undefined;
  };
  const stream: OpenedStream & { emitter: EventEmitter } = {
    emitter,
    on: on as OpenedStream['on'],
    abort: vi.fn(),
  };
  return stream;
}

/** A minimal Event stub — the tests only care about identity, not structure. */
const fakeEvent = { type: 'EventServerConnected' } as unknown as Event;

// ---------------------------------------------------------------------------
// Test 1 – forwards parsed events to the onEvent callback
// ---------------------------------------------------------------------------
describe('connectEventStream', () => {
  it('forwards parsed events to onEvent callback', async () => {
    const received: Event[] = [];
    let resolveOpen!: (s: OpenedStream) => void;

    const stream = makeFakeStream();
    const open = vi.fn(() => new Promise<OpenedStream>(res => { resolveOpen = res; }));

    connectEventStream({
      open,
      onEvent: e => received.push(e),
      onError: () => {},
      onReconnect: () => {},
    });

    // Let the initial dial() microtask run, then hand back the stream.
    await Promise.resolve();
    resolveOpen(stream);
    // Allow the stream-registration microtasks to settle.
    await Promise.resolve();
    await Promise.resolve();

    stream.emitter.emit('event', fakeEvent);
    stream.emitter.emit('event', fakeEvent);

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(fakeEvent);
    expect(received[1]).toBe(fakeEvent);
  });

  // -------------------------------------------------------------------------
  // Test 2 – reconnects after error with correct attempt count
  // -------------------------------------------------------------------------
  it('reconnects after error with correct attempt count', async () => {
    vi.useFakeTimers();

    const reconnectAttempts: number[] = [];
    let callCount = 0;
    let firstStream: (OpenedStream & { emitter: EventEmitter }) | undefined;

    const open = vi.fn(async () => {
      callCount++;
      const s = makeFakeStream();
      if (callCount === 1) {
        firstStream = s;
      }
      return s as OpenedStream;
    });

    const handle = connectEventStream({
      open,
      onEvent: () => {},
      onError: () => {},
      onReconnect: (attempt) => reconnectAttempts.push(attempt),
      backoffMs: () => 10,
    });

    // Let the first dial() run.
    await Promise.resolve();
    await Promise.resolve();

    // Trigger an error on the first stream.
    firstStream!.emitter.emit('error', new Error('network hiccup'));

    // onReconnect should have been called synchronously within the error handler.
    expect(reconnectAttempts).toEqual([1]);

    // Advance timers to fire the reconnect setTimeout(dial, 10).
    await vi.runAllTimersAsync();

    // open() should have been called a second time.
    expect(open).toHaveBeenCalledTimes(2);

    handle.close();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Test 3 – close() stops further reconnections
  // -------------------------------------------------------------------------
  it('close() stops further reconnections after a close event', async () => {
    vi.useFakeTimers();

    let firstStream: (OpenedStream & { emitter: EventEmitter }) | undefined;

    const open = vi.fn(async () => {
      const s = makeFakeStream();
      if (!firstStream) firstStream = s;
      return s as OpenedStream;
    });

    const handle = connectEventStream({
      open,
      onEvent: () => {},
      onError: () => {},
      onReconnect: () => {},
      backoffMs: () => 100,
    });

    // Let the first dial() resolve.
    await Promise.resolve();
    await Promise.resolve();

    // Trigger a close which would normally schedule a reconnect.
    firstStream!.emitter.emit('close');

    // Immediately stop — before the timer fires.
    handle.close();

    // Advance timers; no second open() call should occur.
    await vi.runAllTimersAsync();

    expect(open).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
