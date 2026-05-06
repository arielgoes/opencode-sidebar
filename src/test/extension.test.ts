import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('opencode-sidebar smoke', () => {
  test('extension activates and registers all commands', async () => {
    const ext = vscode.extensions.getExtension('undefined_publisher.opencode-sidebar');
    assert.ok(ext, 'extension should be present in test runner');
    await ext.activate();

    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('opencode.newSession'),    'opencode.newSession command missing');
    assert.ok(cmds.includes('opencode.restartServer'), 'opencode.restartServer command missing');
    assert.ok(cmds.includes('opencode.openSettings'),  'opencode.openSettings command missing');
    assert.ok(cmds.includes('opencode.focusSidebar'),  'opencode.focusSidebar command missing');
  });

  test('sidebar view is registered', async () => {
    // Opening the sidebar view should not throw
    await vscode.commands.executeCommand('workbench.view.extension.opencode');
    // No assertion needed — no exception means registration is correct
  });
});
