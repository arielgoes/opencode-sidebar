import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { startOpencodeServer } from '../opencode/serverProcess';

function fakeChild(opts: { stdoutLines: string[]; stderrLines?: string[]; exitCode?: number | null } = { stdoutLines: [] }) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 12345;
  child.exitCode = null; // mirrors real ChildProcess before exit
  setImmediate(() => {
    for (const line of opts.stdoutLines) child.stdout.emit('data', Buffer.from(line + '\n'));
    for (const line of opts.stderrLines ?? []) child.stderr.emit('data', Buffer.from(line + '\n'));
    if (opts.exitCode !== undefined) child.emit('exit', opts.exitCode);
  });
  return child;
}

describe('startOpencodeServer', () => {
  it('resolves with the URL parsed from "opencode server listening on …" stdout', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({
      stdoutLines: [
        'Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.',
        'opencode server listening on http://127.0.0.1:53901',
      ],
    }));
    const handle = await startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '/tmp' }, { spawn });
    expect(handle.url).toBe('http://127.0.0.1:53901');
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['serve', '--port', '0', '--hostname', '127.0.0.1'],
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });

  it('rejects when child exits before announcing a port', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({ stdoutLines: ['some other output'], exitCode: 127 }));
    await expect(startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '/tmp' }, { spawn }))
      .rejects.toThrow(/exited with code 127/);
  });

  it('forwards extraArgs after the default serve flags', async () => {
    const spawn = vi.fn().mockReturnValue(fakeChild({ stdoutLines: ['opencode server listening on http://127.0.0.1:1'] }));
    await startOpencodeServer({ binaryPath: 'opencode', extraArgs: ['--log-level', 'DEBUG'], cwd: '.' }, { spawn });
    expect(spawn.mock.calls[0][1]).toEqual(['serve', '--port', '0', '--hostname', '127.0.0.1', '--log-level', 'DEBUG']);
  });

  it('dispose() sends SIGTERM and resolves once the child exits', async () => {
    const child = fakeChild({ stdoutLines: ['opencode server listening on http://127.0.0.1:1'] });
    const spawn = vi.fn().mockReturnValue(child);
    const handle = await startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '.' }, { spawn });
    setImmediate(() => child.emit('exit', 0));
    await handle.dispose();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects when spawn emits an error (e.g. binary not found)', async () => {
    const child = fakeChild({ stdoutLines: [] });
    const spawn = vi.fn().mockReturnValue(child);
    const p = startOpencodeServer({ binaryPath: 'opencode', extraArgs: [], cwd: '/tmp' }, { spawn });
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    await expect(p).rejects.toThrow('spawn ENOENT');
  });
});
