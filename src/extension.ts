import * as vscode from 'vscode';
import { ClaudeTerminalProvider } from './ClaudeTerminalProvider';

let provider: ClaudeTerminalProvider;

export function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel('Claude Code Panel', { log: true });
    context.subscriptions.push(log);
    log.info('Extension activating');

    provider = new ClaudeTerminalProvider(context, log);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'claudeCodePanel.terminalView',
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('claudeCodePanel.restart', () => {
            provider.restart();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('claudeCodePanel.clear', () => {
            provider.clear();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('claudeCodePanel.focus', () => {
            provider.focus();
        })
    );
}

export function deactivate() {
    provider?.dispose();
}
