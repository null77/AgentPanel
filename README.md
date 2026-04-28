# Agent Panel

A VS Code extension that hosts a TUI agent CLI as a dedicated tab in the bottom
panel, next to Terminal, Problems, and Output. One panel slot, any agent —
switch between them on demand without opening more terminals.

Out of the box it knows about **Claude Code** and **OpenCode**. You can add or
override agents via settings, so any CLI that runs as an interactive TUI works.

## Features

- Bottom-panel tab that hosts an agent in a real PTY (xterm.js + node-pty).
- Built-in support for Claude Code and OpenCode; switch between them from a
  title-bar button.
- Custom agents via a single settings array — no rebuild required.
- Active agent persists per workspace and across workspaces (global fallback).
- Theme- and font-synced with VS Code's terminal.

## Requirements

- VS Code 1.85 or later.
- The agent's CLI must be on `PATH` (or specified as an absolute path in
  settings). For the built-ins, that means `claude` and/or `opencode`.
- A system-installed Node.js (used to run the PTY host out-of-process; this
  sidesteps a ConPTY deadlock that hits Electron's bundled Node on Windows).

## Switching agents

Open the bottom panel and click the **Agent Panel** tab. Use the **↔ Switch
Agent** button in the view's title bar to pick from the available agents. The
active agent's name appears next to the view title; your choice is remembered
for the workspace.

The same picker is available from the command palette as **Agent Panel: Switch
Agent**, alongside **Restart Agent** and **Clear Agent Terminal**.

## Configuration

| Setting | Type | Description |
|---|---|---|
| `agentPanel.agents` | array | Custom agent definitions. Entries with an `id` matching a built-in (`claude-code`, `opencode`) override that built-in; new ids extend the list. |
| `agentPanel.defaultAgent` | string | Agent id launched on first open when no previous selection exists. Defaults to `claude-code`. |
| `agentPanel.hiddenBuiltins` | array | Built-in ids to hide from the picker. Useful if you only use one of them. |

### Adding a custom agent

```jsonc
// settings.json
"agentPanel.agents": [
  {
    "id": "aider",
    "label": "Aider",
    "command": "aider",
    "args": ["--no-auto-commits"],
    "env": { "AIDER_NO_TELEMETRY": "1" },
    "icon": "sparkle"
  }
]
```

`command` accepts either a bare name (resolved via `where`/`which` at spawn
time) or an absolute path. `args` and `env` are optional. `icon` is an
optional codicon id shown in the picker.

### Example: hide Claude Code, keep OpenCode

```jsonc
"agentPanel.hiddenBuiltins": ["claude-code"],
"agentPanel.defaultAgent": "opencode"
```

## Development

```bash
npm install
npm run build      # one-shot
npm run watch      # rebuild on save
```

Press **F5** in VS Code with this folder open to launch the Extension
Development Host. The included `.vscode/launch.json` is wired up for it. To
run from the command line instead:

```bash
code --extensionDevelopmentPath=C:/src/Panel <some-test-workspace>
```

(Use forward slashes on Windows — Git Bash strips unquoted backslashes from
arguments.)

### Project layout

```
src/
  extension.ts              activation, command registration, QuickPick
  AgentRegistry.ts          built-ins + settings merge
  AgentTerminalProvider.ts  webview lifecycle, PTY host management
  ptyHost.js                child-process Node host that owns node-pty
  utils.ts                  locates VS Code's bundled node-pty
media/
  main.js                   xterm.js client running in the webview
```

The PTY host is intentionally split into a separate process spawned with the
system Node binary. `cp.fork()` would inherit Electron's binary, which has a
ConPTY deadlock on Windows. The host re-uses `node-pty` shipped inside
VS Code's `app.asar.unpacked`, so the extension itself does not bundle native
modules.

## Caveats

- Renaming an agent in `agentPanel.agents` while a session is running does not
  auto-restart it; an info message asks you to restart manually. Use the
  Restart button.
- The extension reuses `node-pty` from VS Code's installation. A future
  VS Code refactor that moves or removes that module would break the agent
  spawn step.
- Versions before 0.2.0 used different command and view ids
  (`claudeCodePanel.*`). Any keybindings or pinned panel positions tied to
  those will need to be re-pointed at `agentPanel.*`.
