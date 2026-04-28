import * as vscode from 'vscode';

export interface AgentDefinition {
    id: string;
    label: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    icon?: string;
}

const BUILTINS: readonly AgentDefinition[] = Object.freeze([
    { id: 'claude-code', label: 'Claude Code', command: 'claude', icon: 'sparkle' },
    { id: 'opencode',    label: 'OpenCode',    command: 'opencode', icon: 'rocket' },
]);

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTINS.map(a => a.id));

export class AgentRegistry implements vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private _agents: AgentDefinition[] = [];
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(private readonly _log: vscode.LogOutputChannel) {
        this._rebuild();
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('agentPanel')) {
                    this._rebuild();
                    this._onDidChange.fire();
                }
            })
        );
    }

    list(): AgentDefinition[] {
        return this._agents.slice();
    }

    getAgent(id: string): AgentDefinition | undefined {
        return this._agents.find(a => a.id === id);
    }

    /**
     * Resolve the default agent: settings value if it points to an existing agent,
     * otherwise the first agent in the list.
     */
    default(): AgentDefinition | undefined {
        const cfg = vscode.workspace.getConfiguration('agentPanel');
        const id = cfg.get<string>('defaultAgent');
        if (id) {
            const found = this.getAgent(id);
            if (found) { return found; }
        }
        return this._agents[0];
    }

    isBuiltin(id: string): boolean {
        return BUILTIN_IDS.has(id);
    }

    private _rebuild(): void {
        const cfg = vscode.workspace.getConfiguration('agentPanel');
        const userAgents = cfg.get<AgentDefinition[]>('agents') ?? [];
        const hidden = new Set(cfg.get<string[]>('hiddenBuiltins') ?? []);

        const merged = new Map<string, AgentDefinition>();
        for (const a of BUILTINS) {
            if (!hidden.has(a.id)) {
                merged.set(a.id, { ...a });
            }
        }
        for (const a of userAgents) {
            if (!a || typeof a.id !== 'string' || typeof a.label !== 'string' || typeof a.command !== 'string') {
                this._log.warn(`Skipping invalid agent entry: ${JSON.stringify(a)}`);
                continue;
            }
            merged.set(a.id, {
                id: a.id,
                label: a.label,
                command: a.command,
                args: Array.isArray(a.args) ? a.args.slice() : undefined,
                env: a.env && typeof a.env === 'object' ? { ...a.env } : undefined,
                icon: typeof a.icon === 'string' ? a.icon : undefined,
            });
        }

        this._agents = Array.from(merged.values());
        this._log.info(`Agent registry rebuilt: ${this._agents.map(a => a.id).join(', ')}`);
    }

    dispose(): void {
        this._onDidChange.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
