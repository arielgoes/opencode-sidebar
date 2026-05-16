import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { startOpencodeServer, type ServerHandle } from '../opencode/serverProcess';
import { createApiClient } from '../opencode/apiClient';
import { connectEventStream, openSdkEventStream } from '../opencode/sseClient';
import { MessageBridge } from './messageBridge';
import type { EventFromWebview, EventToWebview } from './bridgeProtocol';

/** Find the URL of any already-running `opencode serve` process on Linux/macOS. */
async function detectRunningServer(): Promise<string | null> {
  return new Promise(resolve => {
    // Find PIDs of opencode serve processes (excluding our own spawned child which
    // we'd already know about). Works on Linux (ss) and macOS (lsof).
    exec('pgrep -f "opencode serve"', (err, stdout) => {
      if (err || !stdout.trim()) { resolve(null); return; }
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length === 0) { resolve(null); return; }

      // On Linux: use ss to find the port this process is listening on
      exec(`ss -tlnp 2>/dev/null | grep -E '(${pids.join('|')})'`, (err2, out2) => {
        if (!err2 && out2) {
          const m = out2.match(/127\.0\.0\.1:(\d+)/);
          if (m) { resolve(`http://127.0.0.1:${m[1]}`); return; }
        }
        // macOS fallback: lsof
        exec(`lsof -p ${pids[0]} -i TCP -n -P 2>/dev/null | grep LISTEN`, (err3, out3) => {
          if (!err3 && out3) {
            const m2 = out3.match(/:(\d+) \(LISTEN\)/);
            if (m2) { resolve(`http://127.0.0.1:${m2[1]}`); return; }
          }
          resolve(null);
        });
      });
    });
  });
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'opencode.sidebar';

  private view?: vscode.WebviewView;
  private server?: ServerHandle;
  private bridge?: MessageBridge;
  private sseHandle?: { close(): void };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    view.webview.html = await this.buildHtml(view.webview);
    view.webview.onDidReceiveMessage((msg: EventFromWebview) => {
      if (msg.type === 'restartServer') { void this.restartServer(); return; }
      if (msg.type === 'addProviderKey' || msg.type === 'manageProviderKeys') {
        void vscode.commands.executeCommand('opencode.manageProviderKeys');
        return;
      }
      this.bridge?.handle(msg);
    });
    await this.startServer();
  }

  async restartServer(): Promise<void> {
    this.sseHandle?.close();
    if (!this._attachedUrl) {
      await this.server?.dispose();
      this.server = undefined;
    }
    this.bridge = undefined;
    await this.startServer();
  }

  getServerUrl(): string | undefined {
    return this._attachedUrl ?? this.server?.url;
  }
  private _attachedUrl?: string;

  async dispose(): Promise<void> {
    this.sseHandle?.close();
    await this.server?.dispose();
  }

  private async startServer(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('opencode');
    const binaryPath: string = cfg.get('binaryPath') ?? 'opencode';
    const extraArgs: string[] = cfg.get('serverArgs') ?? [];
    const serverUrl: string = cfg.get('serverUrl') ?? '';
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    this.post({ type: 'serverStatus', status: 'starting' });

    // If serverUrl is set, use it. Otherwise auto-detect a running server.
    const manualUrl = serverUrl ? serverUrl.replace(/\/$/, '') : null;
    const detectedUrl = manualUrl ? null : await detectRunningServer();
    const attachUrl = manualUrl ?? detectedUrl;

    if (attachUrl) {
      // Attach mode — connect to an already-running opencode serve
      this._attachedUrl = attachUrl;
      const source = manualUrl ? 'configured' : 'auto-detected';
      this.outputChannel.appendLine(`[opencode] attaching to ${this._attachedUrl} (${source})`);
      try {
        const res = await fetch(`${this._attachedUrl}/config`);
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
      } catch (err) {
        if (detectedUrl) {
          // Auto-detected server is unreachable — fall through to spawn
          this.outputChannel.appendLine(`[opencode] auto-detected server unreachable, spawning new one`);
          this._attachedUrl = undefined;
        } else {
          const message = `Cannot reach ${this._attachedUrl}: ${err instanceof Error ? err.message : String(err)}`;
          this.outputChannel.appendLine(`[opencode] ${message}`);
          this.post({ type: 'serverStatus', status: 'error', error: message });
          return;
        }
      }
    }

    if (!this._attachedUrl) {
      // Spawn mode — start our own opencode serve
      this._attachedUrl = undefined;
      try {
        this.server = await startOpencodeServer({ binaryPath, extraArgs, cwd });
        this.outputChannel.appendLine(`[opencode] server at ${this.server.url}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`[opencode] failed to start: ${message}`);
        this.post({ type: 'serverStatus', status: 'error', error: message });
        return;
      }
    }

    const baseUrl = this._attachedUrl ?? this.server!.url;
    // In attach mode, don't pass directory — let the external server use its own defaults.
    // In spawn mode, pass cwd so the server runs tools in the right workspace.
    const directory = this._attachedUrl ? undefined : cwd;
    const api = createApiClient({ baseUrl, directory });
    this.bridge = new MessageBridge({
      api,
      post: msg => this.post(msg),
      onRestartServer: () => void this.restartServer(),
      directory: directory ?? '',
      serverUrl: baseUrl,
    });

    this.sseHandle = connectEventStream({
      open: () => openSdkEventStream(api.raw),
      onEvent: e => {
        const ev = e as any;
        if (ev.type === 'session.error') {
          const err = ev.properties?.error;
          const msg = err?.data?.message ?? err?.message ?? JSON.stringify(err ?? ev);
          this.outputChannel.appendLine(`[opencode] session.error: ${msg}`);
        }
        if (ev.type === 'permission.updated') {
          this.outputChannel.appendLine(`[opencode] permission.updated: ${JSON.stringify(ev.properties)}`);
        }
        if (ev.type === 'message.part.updated') {
          const p = ev.properties?.part as any;
          this.outputChannel.appendLine(`[opencode] part.updated: ${p?.id} ${p?.type} ${p?.tool ?? ''} status=${p?.state?.status ?? '?'} out=${String(p?.state?.output ?? '').slice(0, 40)}`);
        }
        this.post({ type: 'sse', event: ev });
      },
      onError: err => this.outputChannel.appendLine(`[opencode] sse error: ${String(err)}`),
      onReconnect: () => this.post({ type: 'serverStatus', status: 'reconnecting' }),
    });

    this.post({ type: 'serverStatus', status: 'ready' });
    // Webview sends {type:'ready'} on load, but bridge isn't set yet at that point.
    // Trigger the session/provider fetch directly now that the bridge is ready.
    void this.bridge.handle({ type: 'ready' });
  }

  private post(msg: EventToWebview): void {
    this.view?.webview.postMessage(msg);
  }

  private async buildHtml(webview: vscode.Webview): Promise<string> {
    const mainJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js'),
    ).toString();
    const uiCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'ui.css'),
    ).toString();
    const tplPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'index.html');
    const tpl = await fs.readFile(tplPath, 'utf8');
    const nonce = generateNonce();
    return tpl
      .replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{mainJsUri}}', mainJsUri)
      .replaceAll('{{uiCssUri}}', uiCssUri);
  }
}

function generateNonce(): string {
  const arr = new Uint8Array(16);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
