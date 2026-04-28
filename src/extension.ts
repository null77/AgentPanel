import * as vscode from 'vscode';
import { AgentRegistry, AgentDefinition } from './AgentRegistry';
import { AgentTerminalProvider } from './AgentTerminalProvider';

let provider: AgentTerminalProvider;
let registry: AgentRegistry;

const CONFIGURE_ITEM_ID = '__configure__';

export function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel('Agent Panel', { log: true });
    context.subscriptions.push(log);
    log.info('Extension activating');

    registry = new AgentRegistry(log);
    context.subscriptions.push(registry);

    provider = new AgentTerminalProvider(context, log, registry);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'agentPanel.terminalView',
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    context.subscriptions.push(
        registry.onDidChange(() => {
            const previousId = provider.activeAgent.id;
            provider.reconcileWithRegistry();
            if (provider.activeAgent.id === previousId) {
                vscode.window.showInformationMessage(
                    'Agent Panel: agent settings updated. Restart the panel to apply changes to the running session.'
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentPanel.restart', () => {
            provider.restart();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentPanel.clear', () => {
            provider.clear();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentPanel.focus', () => {
            provider.focus();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agentPanel.switchAgent', async () => {
            await runSwitchAgentPicker();
        })
    );
}

interface AgentPickItem extends vscode.QuickPickItem {
    agent?: AgentDefinition;
    actionId?: string;
}

async function runSwitchAgentPicker(): Promise<void> {
    const agents = registry.list();
    const activeId = provider.activeAgent.id;

    const items: AgentPickItem[] = agents.map(a => ({
        label: a.icon ? `$(${a.icon}) ${a.label}` : a.label,
        description: a.id === activeId ? `${a.id} (active)` : a.id,
        detail: describeAgentCommand(a),
        agent: a,
    }));

    if (agents.length === 0) {
        items.push({
            label: 'No agents configured',
            description: 'All built-ins are hidden and no custom agents are defined.',
            kind: vscode.QuickPickItemKind.Separator,
        });
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
        label: '$(gear) Configure agents...',
        description: 'Open settings',
        actionId: CONFIGURE_ITEM_ID,
    });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Select an agent (current: ${provider.activeAgent.label})`,
        matchOnDescription: true,
    });

    if (!picked) { return; }

    if (picked.actionId === CONFIGURE_ITEM_ID) {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:jmadill.agent-panel'
        );
        return;
    }

    if (picked.agent) {
        await provider.switchAgent(picked.agent);
    }
}

function describeAgentCommand(a: AgentDefinition): string {
    const parts = [a.command];
    if (a.args && a.args.length) {
        parts.push(...a.args);
    }
    return parts.join(' ');
}

export function deactivate() {
    provider?.dispose();
}
