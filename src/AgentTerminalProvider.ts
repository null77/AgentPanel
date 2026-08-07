import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { findNodePtyPath, expandEnvValue } from './utils';
import { AgentDefinition, AgentRegistry } from './AgentRegistry';

const STATE_KEY = 'agentPanel.activeAgentId';

export class AgentTerminalProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _ptyHost?: cp.ChildProcess;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _pendingOutput: string[] = [];
    private _lastCols = 80;
    private _lastRows = 24;
    private _activeAgent: AgentDefinition;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _log: vscode.LogOutputChannel,
        private readonly _registry: AgentRegistry
    ) {
        this._activeAgent = this._resolveInitialAgent();
        this._log.info(`Initial agent: ${this._activeAgent.id} (${this._activeAgent.label})`);
    }

    get activeAgent(): AgentDefinition {
        return this._activeAgent;
    }

    private _resolveInitialAgent(): AgentDefinition {
        const wsId = this._context.workspaceState.get<string>(STATE_KEY);
        if (wsId) {
            const found = this._registry.getAgent(wsId);
            if (found) { return found; }
        }
        const globalId = this._context.globalState.get<string>(STATE_KEY);
        if (globalId) {
            const found = this._registry.getAgent(globalId);
            if (found) { return found; }
        }
        const def = this._registry.default();
        if (def) { return def; }
        // Last resort if registry is empty (e.g. user hid all built-ins and added none)
        return { id: 'claude-code', label: 'Claude Code', command: 'claude' };
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._log.info('resolveWebviewView called');

        // Clean up previous state if the panel was moved/recreated
        this._killProcess();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
        this._ready = false;
        this._pendingOutput = [];

        this._view = webviewView;
        webviewView.description = this._activeAgent.label;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._context.extensionUri, 'media'),
                vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'xterm'),
                vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'addon-fit'),
                vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'addon-webgl'),
            ],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            undefined,
            this._disposables
        );

        webviewView.onDidDispose(() => {
            this._killProcess();
            this._view = undefined;
            this._ready = false;
        }, undefined, this._disposables);

        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                this._sendTheme();
            })
        );

        // Re-focus xterm when the view becomes visible (panel tab re-opened).
        // Without this, the iframe gets focus but xterm's hidden textarea
        // doesn't, and keystrokes fall through to VS Code shortcuts (Alt-key
        // opens the menubar). The webview-side `window` focus listener
        // handles the OS-focus-regained case for free — forwarding focus
        // only when the iframe is actually the focus target, so clicks
        // elsewhere in VS Code (e.g. the integrated terminal) don't get
        // hijacked back to the panel.
        this._disposables.push(
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    webviewView.webview.postMessage({ type: 'focus' });
                }
            })
        );

        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration('terminal.integrated.fontFamily') ||
                    e.affectsConfiguration('terminal.integrated.fontSize') ||
                    e.affectsConfiguration('terminal.integrated.lineHeight') ||
                    e.affectsConfiguration('editor.fontFamily') ||
                    e.affectsConfiguration('editor.fontSize')
                ) {
                    this._sendTheme();
                }
            })
        );
    }

    private _handleMessage(message: { type: string; data?: string; cols?: number; rows?: number }): void {
        if (message.type !== 'input') {
            this._log.info(`Received message: ${message.type}`, message.cols, message.rows);
        }
        switch (message.type) {
            case 'ready':
                this._ready = true;
                if (message.cols) { this._lastCols = message.cols; }
                if (message.rows) { this._lastRows = message.rows; }
                this._sendTheme();
                for (const data of this._pendingOutput) {
                    this._view?.webview.postMessage({ type: 'output', data });
                }
                this._pendingOutput = [];
                this._spawnProcess(this._lastCols, this._lastRows);
                break;
            case 'input':
                if (message.data && this._ptyHost?.connected) {
                    this._ptyHost.send({ type: 'input', data: message.data });
                }
                break;
            case 'resize':
                if (message.cols) { this._lastCols = message.cols; }
                if (message.rows) { this._lastRows = message.rows; }
                if (message.cols && message.rows && this._ptyHost?.connected) {
                    this._ptyHost.send({ type: 'resize', cols: message.cols, rows: message.rows });
                }
                break;
            case 'requestRestart':
                this.restart();
                break;
            case 'requestSwitchAgent':
                void vscode.commands.executeCommand('agentPanel.switchAgent');
                break;
            case 'copy':
                if (typeof message.data === 'string' && message.data) {
                    void vscode.env.clipboard.writeText(message.data);
                }
                break;
            case 'requestPaste':
                void this._handlePasteRequest();
                break;
        }
    }

    private async _handlePasteRequest(): Promise<void> {
        try {
            const text = await vscode.env.clipboard.readText();
            // Route back through the webview's xterm.paste() rather than
            // writing straight to the PTY. xterm wraps the text in bracketed
            // paste markers (ESC[200~ … ESC[201~) when the agent has enabled
            // that mode and normalizes newlines to CR. Sending raw bytes here
            // skipped both, so a multi-line paste was interpreted line-by-line
            // — each newline submitting a partial prompt and leaving the agent
            // looking hung.
            if (text && this._view) {
                this._view.webview.postMessage({ type: 'paste', data: text });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log.warn(`Clipboard read failed: ${msg}`);
        }
    }

    private _spawnProcess(cols?: number, rows?: number): void {
        this._log.info(`_spawnProcess called, cols=${cols}, rows=${rows}, agent=${this._activeAgent.id}`);
        this._killProcess();

        let nodePtyPath: string;
        try {
            nodePtyPath = findNodePtyPath(this._log);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log.error(`Failed to find node-pty: ${msg}`);
            this._postOutput(`\x1b[31mError: ${msg}\x1b[0m\r\n`);
            return;
        }
        this._log.info(`Found node-pty: ${nodePtyPath}`);

        // On Windows, fork the PTY host with a system Node binary to dodge a
        // ConPTY deadlock that hits Electron's bundled Node. On macOS, Linux,
        // and WSL, fork uses Electron's Node directly — its ABI matches VS
        // Code's bundled node-pty, so no system Node is required.
        const ptyHostScript = path.join(this._context.extensionPath, 'dist', 'ptyHost.js');
        this._log.info(`Pty host script: ${ptyHostScript}`);

        const forkOptions: cp.ForkOptions = {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            execArgv: [],
        };
        if (process.platform === 'win32') {
            forkOptions.execPath = this._findSystemNode();
            this._log.info(`Using system Node.js: ${forkOptions.execPath}`);
        } else {
            this._log.info(`Using Electron's bundled Node`);
        }

        this._postOutput(`\x1b[2mStarting ${this._activeAgent.label}...\x1b[0m\r\n`);

        try {
            this._ptyHost = cp.fork(ptyHostScript, [nodePtyPath], forkOptions);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log.error(`Failed to fork pty host: ${msg}`);
            this._postOutput(`\x1b[31mFailed to fork pty host: ${msg}\x1b[0m\r\n`);
            return;
        }

        this._log.info(`Pty host forked, pid=${this._ptyHost.pid}`);

        const readyTimeout = setTimeout(() => {
            this._log.warn('Pty host never sent ready message after 5s');
            this._postOutput('\x1b[33mTimeout waiting for pty host\x1b[0m\r\n');
        }, 5000);

        this._ptyHost.stdout?.on('data', (data: Buffer) => {
            this._log.info(`ptyHost stdout: ${data.toString().trim()}`);
        });

        this._ptyHost.stderr?.on('data', (data: Buffer) => {
            this._log.warn(`ptyHost stderr: ${data.toString().trim()}`);
        });

        this._ptyHost.on('error', (err) => {
            clearTimeout(readyTimeout);
            this._log.error(`Pty host error: ${err.message}`);
            this._postOutput(`\x1b[31mError: ${err.message}\x1b[0m\r\n`);
        });

        const thisHost = this._ptyHost;
        this._ptyHost.on('exit', (code, signal) => {
            clearTimeout(readyTimeout);
            this._log.info(`Pty host exited, code=${code}, signal=${signal}`);
            // Only clear reference if it's still the same pty host (not a new one after restart)
            if (this._ptyHost === thisHost) {
                this._ptyHost = undefined;
            }
        });

        this._ptyHost.on('message', (msg: { type: string; [key: string]: unknown }) => {
            this._log.info(`ptyHost message: ${msg.type}`);
            switch (msg.type) {
                case 'ready':
                    clearTimeout(readyTimeout);
                    this._sendSpawnCommand(cols, rows);
                    break;
                case 'spawned':
                    this._log.info(`Process spawned in pty host, pid=${msg.pid}`);
                    break;
                case 'data':
                    this._postOutput(msg.data as string);
                    break;
                case 'exit':
                    this._log.info(`Process exited, code=${msg.exitCode}, signal=${msg.signal}`);
                    this._view?.webview.postMessage({ type: 'exit', exitCode: msg.exitCode as number });
                    break;
                case 'error':
                    clearTimeout(readyTimeout);
                    this._log.error(`Pty host reported error: ${msg.message}`);
                    this._postOutput(`\x1b[31m${msg.message}\x1b[0m\r\n`);
                    break;
                case 'log':
                    this._log.info(`ptyHost: ${msg.text}`);
                    break;
            }
        });
    }

    private _sendSpawnCommand(_cols?: number, _rows?: number): void {
        if (!this._ptyHost?.connected) { return; }

        // Always spawn at the latest known dims rather than whatever was
        // captured at webview-ready time. The container may still be
        // animating open when `ready` fires, so a `resize` typically follows
        // shortly after — we want the spawn to honor that final size.
        const cols = this._lastCols;
        const rows = this._lastRows;

        const agent = this._activeAgent;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

        const args = agent.args ? agent.args.slice() : [];

        // Resolve full path to the agent binary since node-pty needs it.
        // Use execFileSync (not execSync) so a user-supplied command can't be
        // shell-interpolated as an injection vector.
        let file: string;
        if (path.isAbsolute(agent.command) && fs.existsSync(agent.command)) {
            file = agent.command;
            this._log.info(`Using absolute agent path: ${file}`);
        } else {
            try {
                const lookupBin = process.platform === 'win32' ? 'where' : 'which';
                const out = cp.execFileSync(lookupBin, [agent.command], {
                    encoding: 'utf8',
                    timeout: 5000,
                }).trim();
                file = out.split(/\r?\n/)[0] || agent.command;
                this._log.info(`Resolved ${agent.command} → ${file}`);
            } catch {
                file = agent.command;
                this._log.warn(`Could not resolve ${agent.command}, using bare name`);
            }
        }

        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) {
                env[key] = value;
            }
        }
        env['FORCE_COLOR'] = '1';
        env['COLORTERM'] = 'truecolor';
        if (agent.env) {
            for (const [k, v] of Object.entries(agent.env)) {
                env[k] = expandEnvValue(v);
            }
        }

        this._log.info(`Sending spawn: ${file} ${args.join(' ')} in ${workspaceFolder}`);

        this._ptyHost.send({
            type: 'spawn',
            file,
            args,
            options: {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: workspaceFolder,
                env,
            },
        });
    }

    /**
     * Locate a system-installed Node.js binary. Windows-only — used to dodge
     * the ConPTY deadlock that hits Electron's bundled Node when forking the
     * PTY host. Other platforms use Electron's Node directly.
     */
    private _findSystemNode(): string {
        const candidates: string[] = [];

        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        candidates.push(path.join(programFiles, 'nodejs', 'node.exe'));

        const nvmSymlink = process.env['NVM_SYMLINK'];
        if (nvmSymlink) {
            candidates.push(path.join(nvmSymlink, 'node.exe'));
        }
        const localAppData = process.env['LOCALAPPDATA'];
        if (localAppData) {
            candidates.push(path.join(localAppData, 'fnm_multishells', 'node.exe'));
            candidates.push(path.join(localAppData, 'volta', 'bin', 'node.exe'));
        }

        try {
            const result = cp.execFileSync('where', ['node'], { encoding: 'utf8', timeout: 3000 }).trim();
            for (const line of result.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !candidates.includes(trimmed)) {
                    candidates.unshift(trimmed);
                }
            }
        } catch {
            // 'where node' returned non-zero — Node may not be on PATH.
        }

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                this._log.info(`Found system Node.js: ${candidate}`);
                return candidate;
            }
        }

        this._log.warn('Could not find system Node.js, falling back to "node"');
        return 'node';
    }

    private _postOutput(data: string): void {
        if (this._ready && this._view) {
            this._view.webview.postMessage({ type: 'output', data });
        } else {
            this._pendingOutput.push(data);
        }
    }

    private _sendTheme(): void {
        const termConfig = vscode.workspace.getConfiguration('terminal.integrated');
        const editorConfig = vscode.workspace.getConfiguration('editor');

        const WINDOWS_DEFAULT = "'Cascadia Mono', Consolas, 'Courier New', monospace";
        const MAC_DEFAULT = "Menlo, Monaco, 'Courier New', monospace";
        const LINUX_DEFAULT = "'Droid Sans Mono', 'monospace', monospace";
        const platformDefault = process.platform === 'win32' ? WINDOWS_DEFAULT
            : process.platform === 'darwin' ? MAC_DEFAULT : LINUX_DEFAULT;

        const fontFamily = termConfig.get<string>('fontFamily')
            || editorConfig.get<string>('fontFamily')
            || platformDefault;
        const fontSize = termConfig.get<number>('fontSize')
            || editorConfig.get<number>('fontSize')
            || 14;
        const lineHeight = termConfig.get<number>('lineHeight') || 1.0;

        this._view?.webview.postMessage({
            type: 'setTheme',
            fontFamily,
            fontSize,
            lineHeight,
        });
    }

    private _killProcess(): void {
        const host = this._ptyHost;
        if (host) {
            this._ptyHost = undefined;
            try {
                if (host.connected) {
                    host.send({ type: 'shutdown' });
                }
            } catch {
                // Ignore
            }
            setTimeout(() => {
                if (!host.killed) {
                    try { host.kill(); } catch { /* */ }
                }
            }, 500);
        }
    }

    async switchAgent(agent: AgentDefinition): Promise<void> {
        if (agent.id === this._activeAgent.id) {
            this._log.info(`switchAgent: already on ${agent.id}`);
            return;
        }
        this._log.info(`switchAgent: ${this._activeAgent.id} → ${agent.id}`);
        this._activeAgent = agent;
        await this._context.workspaceState.update(STATE_KEY, agent.id);
        await this._context.globalState.update(STATE_KEY, agent.id);
        if (this._view) {
            this._view.description = agent.label;
        }
        this.restart();
    }

    restart(): void {
        if (this._ready && this._view) {
            this._view.webview.postMessage({ type: 'clear' });
            this._killProcess();
            setTimeout(() => this._spawnProcess(this._lastCols, this._lastRows), 300);
        }
    }

    clear(): void {
        this._view?.webview.postMessage({ type: 'clear' });
    }

    focus(): void {
        this._view?.show?.(true);
    }

    /**
     * If the active agent is no longer in the registry, fall back to the
     * default. Called by extension.ts after registry rebuilds.
     */
    reconcileWithRegistry(): void {
        if (this._registry.getAgent(this._activeAgent.id)) {
            return;
        }
        const fallback = this._registry.default();
        if (!fallback) {
            this._log.warn(`Active agent ${this._activeAgent.id} no longer exists and registry is empty`);
            return;
        }
        this._log.info(`Active agent ${this._activeAgent.id} removed; falling back to ${fallback.id}`);
        void this.switchAgent(fallback);
    }

    dispose(): void {
        this._killProcess();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    private _getHtml(webview: vscode.Webview): string {
        const xtermCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')
        );
        const xtermJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js')
        );
        const fitAddonJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js')
        );
        const webglAddonJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'node_modules', '@xterm', 'addon-webgl', 'lib', 'addon-webgl.js')
        );
        const mainJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${xtermCssUri}">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--vscode-terminal-background, var(--vscode-panel-background, #1e1e1e));
        }
        #terminal-container {
            width: 100%;
            height: 100%;
            position: relative;
        }
        #terminal-container .xterm {
            padding: 4px;
        }
        #exit-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            z-index: 10;
            align-items: center;
            justify-content: center;
            flex-direction: column;
        }
        #exit-overlay.visible {
            display: flex;
        }
        #exit-overlay .message {
            color: var(--vscode-foreground, #ccc);
            font-family: var(--vscode-font-family, sans-serif);
            font-size: 14px;
            margin-bottom: 12px;
        }
        #exit-overlay .actions {
            display: flex;
            gap: 8px;
        }
        #exit-overlay button {
            padding: 6px 16px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-family: var(--vscode-font-family, sans-serif);
            font-size: 13px;
        }
        #exit-overlay .restart-btn {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #fff);
        }
        #exit-overlay .restart-btn:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }
        #exit-overlay .switch-btn {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
        }
        #exit-overlay .switch-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        #error-display {
            display: none;
            padding: 16px;
            color: var(--vscode-errorForeground, #f48771);
            font-family: var(--vscode-font-family, sans-serif);
            font-size: 13px;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div id="error-display"></div>
    <div id="terminal-container">
        <div id="exit-overlay">
            <div class="message" id="exit-message">Process exited</div>
            <div class="actions">
                <button class="restart-btn" id="restart-btn">Restart</button>
                <button class="switch-btn" id="switch-btn">Switch Agent</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        // Clear module/exports to prevent UMD libs from using CommonJS path
        var __savedModule = typeof module !== 'undefined' ? module : undefined;
        var __savedExports = typeof exports !== 'undefined' ? exports : undefined;
        if (typeof module !== 'undefined') { module = undefined; }
        if (typeof exports !== 'undefined') { exports = undefined; }
    </script>
    <script nonce="${nonce}" src="${xtermJsUri}"></script>
    <script nonce="${nonce}" src="${fitAddonJsUri}"></script>
    <script nonce="${nonce}" src="${webglAddonJsUri}"></script>
    <script nonce="${nonce}">
        if (__savedModule !== undefined) { module = __savedModule; }
        if (__savedExports !== undefined) { exports = __savedExports; }
    </script>
    <script nonce="${nonce}" src="${mainJsUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
