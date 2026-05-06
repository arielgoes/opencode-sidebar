import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar/SidebarProvider';

let provider: SidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('OpenCode');
  context.subscriptions.push(channel);

  provider = new SidebarProvider(context.extensionUri, channel);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('opencode.newSession', () =>
      vscode.commands.executeCommand('workbench.view.extension.opencode')),
    vscode.commands.registerCommand('opencode.focusSidebar', () =>
      vscode.commands.executeCommand('opencode.sidebar.focus')),
    vscode.commands.registerCommand('opencode.restartServer', () =>
      provider?.restartServer()),
    vscode.commands.registerCommand('opencode.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'opencode')),
    // Both commands open the same unified manager
    vscode.commands.registerCommand('opencode.addProviderKey', () =>
      manageProviderKeys(provider, channel)),
    vscode.commands.registerCommand('opencode.removeProviderKey', () =>
      manageProviderKeys(provider, channel)),
    vscode.commands.registerCommand('opencode.manageProviderKeys', () =>
      manageProviderKeys(provider, channel)),
  );
}

export async function deactivate(): Promise<void> {
  await provider?.dispose();
  provider = undefined;
}

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDER_INFO: Record<string, { name: string; keyUrl: string }> = {
  opencode:  { name: 'OpenCode Go',  keyUrl: 'https://opencode.ai/auth' },
  anthropic: { name: 'Anthropic',    keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai:    { name: 'OpenAI',       keyUrl: 'https://platform.openai.com/api-keys' },
  google:    { name: 'Google AI',    keyUrl: 'https://aistudio.google.com/app/apikey' },
  groq:      { name: 'Groq',         keyUrl: 'https://console.groq.com/keys' },
  mistral:   { name: 'Mistral',      keyUrl: 'https://console.mistral.ai/api-keys' },
  xai:       { name: 'xAI (Grok)',   keyUrl: 'https://console.x.ai' },
  deepseek:  { name: 'DeepSeek',     keyUrl: 'https://platform.deepseek.com/api_keys' },
  cohere:    { name: 'Cohere',       keyUrl: 'https://dashboard.cohere.com/api-keys' },
};

// ── Unified key manager ───────────────────────────────────────────────────────

async function manageProviderKeys(p: SidebarProvider | undefined, channel: vscode.OutputChannel): Promise<void> {
  const serverUrl = p?.getServerUrl();
  if (!serverUrl) {
    vscode.window.showErrorMessage('OpenCode server is not running. Please wait for it to start.');
    return;
  }

  // Fetch currently configured providers
  let configuredIds: string[] = [];
  try {
    const res = await fetch(`${serverUrl}/config/providers`);
    if (res.ok) {
      const data = await res.json() as { providers?: Array<{ id: string }> };
      configuredIds = (data.providers ?? []).map(p => p.id);
    }
  } catch { /* ignore — show list anyway */ }

  // Fetch which providers have auth stored
  let authedIds: Set<string> = new Set();
  try {
    const res = await fetch(`${serverUrl}/provider`);
    if (res.ok) {
      const data = await res.json() as { connected?: string[] };
      authedIds = new Set(data.connected ?? []);
    }
  } catch { /* ignore */ }

  // Build quick-pick items — known providers first, then configured unknowns
  const knownIds = Object.keys(PROVIDER_INFO);
  const allIds = [...new Set([...knownIds, ...configuredIds])];

  type Item = vscode.QuickPickItem & { id: string; action?: 'add' };
  const items: Item[] = allIds.map(id => {
    const info = PROVIDER_INFO[id];
    const hasKey = authedIds.has(id);
    return {
      id,
      label: `$(${hasKey ? 'pass-filled' : 'circle-slash'}) ${info?.name ?? id}`,
      description: id,
      detail: hasKey
        ? '$(check) API key configured — click to update or remove'
        : `$(add) No key stored — click to add${info ? ` (${info.keyUrl})` : ''}`,
      picked: false,
    };
  });

  items.push({ id: '__add__', label: '$(add) Add a different provider…', description: '', action: 'add' });

  const pick = await vscode.window.showQuickPick(items, {
    title: 'OpenCode — Manage Provider Keys',
    placeHolder: 'Select a provider to add, update, or remove its API key',
    matchOnDescription: true,
  });
  if (!pick) return;

  let providerID: string;
  if (pick.action === 'add' || pick.id === '__add__') {
    const entered = await vscode.window.showInputBox({
      title: 'Provider ID',
      prompt: 'Enter the provider ID (e.g. opencode, anthropic, openai)',
      ignoreFocusOut: true,
    });
    if (!entered) return;
    providerID = entered.trim();
  } else {
    providerID = pick.id;
  }

  const info = PROVIDER_INFO[providerID.toLowerCase()];
  const hasKey = authedIds.has(providerID);

  // Offer actions for this provider
  type ActionItem = vscode.QuickPickItem & { cmd: string };
  const actions: ActionItem[] = [
    { label: `$(key) ${hasKey ? 'Update' : 'Add'} API key`, detail: info ? `Key from: ${info.keyUrl}` : undefined, cmd: 'set' },
  ];
  if (hasKey) {
    actions.push({ label: '$(trash) Remove stored key', detail: 'Falls back to CLI credentials (auth.json)', cmd: 'delete' });
  }
  if (info) {
    actions.push({ label: '$(link-external) Open key page in browser', detail: info.keyUrl, cmd: 'open' });
  }

  const action = await vscode.window.showQuickPick(actions, {
    title: `${info?.name ?? providerID} — Choose action`,
    placeHolder: hasKey ? 'Key is already configured' : 'No key stored yet',
  });
  if (!action) return;

  if (action.cmd === 'open') {
    await vscode.env.openExternal(vscode.Uri.parse(info!.keyUrl));
    // Re-open manager so user can paste the key after copying it
    setTimeout(() => manageProviderKeys(p, channel), 500);
    return;
  }

  if (action.cmd === 'set') {
    if (info) {
      const open = await vscode.window.showInformationMessage(
        `Get your ${info.name} key at: ${info.keyUrl}`, 'Open page', 'I already have my key',
      );
      if (open === 'Open page') {
        await vscode.env.openExternal(vscode.Uri.parse(info.keyUrl));
      }
    }
    const apiKey = await vscode.window.showInputBox({
      title: `Enter API key for ${info?.name ?? providerID}`,
      prompt: 'Paste your API key here',
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) return;

    try {
      const res = await fetch(`${serverUrl}/auth/${encodeURIComponent(providerID)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: apiKey }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      vscode.window.showInformationMessage(`API key saved for "${providerID}". Restarting…`);
      channel.appendLine(`[opencode] auth set for provider: ${providerID}`);
      await p?.restartServer();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to save key: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (action.cmd === 'delete') {
    const confirmed = await vscode.window.showWarningMessage(
      `Remove stored key for "${providerID}"? The provider will fall back to its CLI credentials.`,
      { modal: true }, 'Remove',
    );
    if (confirmed !== 'Remove') return;

    try {
      const res = await fetch(`${serverUrl}/auth/${encodeURIComponent(providerID)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      vscode.window.showInformationMessage(`Key removed for "${providerID}". Restarting…`);
      channel.appendLine(`[opencode] auth removed for provider: ${providerID}`);
      await p?.restartServer();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to remove key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
