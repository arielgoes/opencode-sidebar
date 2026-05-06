import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface ServerHandle {
  url: string;
  pid: number;
  dispose(): Promise<void>;
}

export interface ServerOptions {
  binaryPath: string;
  extraArgs: string[];
  cwd: string;
}

export interface ServerDeps {
  spawn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

const URL_RE = /opencode server listening on (https?:\/\/[^\s]+)/;

export async function startOpencodeServer(opts: ServerOptions, deps: ServerDeps = {}): Promise<ServerHandle> {
  const spawn = deps.spawn ?? nodeSpawn;
  const args = ['serve', '--port', '0', '--hostname', '127.0.0.1', ...opts.extraArgs];
  const child = spawn(opts.binaryPath, args, { cwd: opts.cwd, env: process.env });

  return new Promise((resolve, reject) => {
    let buf = '';
    let resolved = false;

    const onStdout = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const m = buf.match(URL_RE);
      if (m && !resolved) {
        resolved = true;
        resolve({
          url: m[1],
          pid: child.pid ?? -1,
          dispose: () => disposeChild(child),
        });
      }
    };

    const onExit = (code: number | null) => {
      if (!resolved) reject(new Error(`opencode exited with code ${code} before announcing port`));
    };

    child.stdout?.on('data', onStdout);
    child.on('exit', onExit);
    child.on('error', err => { if (!resolved) reject(err); });
  });
}

function disposeChild(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(killTimer); resolve(); });
    child.kill('SIGTERM');
  });
}
