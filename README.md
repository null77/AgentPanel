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
- **On Windows only**: a system-installed Node.js. The PTY host runs out of
  process to dodge a ConPTY deadlock in Electron's bundled Node. macOS, Linux,
  and WSL use VS Code's bundled Node directly — no extra install needed.

WSL works the same as native Linux: the VS Code Server extension host runs
inside the distribution, so `process.platform` is `linux` and the
non-Windows code path applies.

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

In `env` values, `~` (home directory) and `${env:VAR}` are expanded at spawn
time, so `~/.foo` and `${env:HOME}/.foo` both work cross-platform.

### Multiple Claude Code profiles (work / personal)

Claude Code reads its config (credentials, memory, settings) from
`CLAUDE_CONFIG_DIR`, falling back to `~/.claude`. Define one custom agent per
profile so each runs against an isolated config directory:

```jsonc
"agentPanel.agents": [
  {
    "id": "claude-work",
    "label": "Claude Code (Work)",
    "command": "claude",
    "icon": "sparkle",
    "env": { "CLAUDE_CONFIG_DIR": "~/.claude-work" }
  },
  {
    "id": "claude-personal",
    "label": "Claude Code (Personal)",
    "command": "claude",
    "icon": "sparkle",
    "env": { "CLAUDE_CONFIG_DIR": "~/.claude-personal" }
  }
]
```

The built-in `claude-code` entry stays available and uses Claude's default
`~/.claude` directory. Use the **Switch Agent** button to move between
profiles; the active selection persists per workspace, so each workspace can
default to a different profile if you like.

The first time you switch into a new profile, run `/login` inside Claude
Code to authenticate against that config dir — credentials, memory, and
settings are kept separate from then on.

### Example: hide Claude Code, keep OpenCode

```jsonc
"agentPanel.hiddenBuiltins": ["claude-code"],
"agentPanel.defaultAgent": "opencode"
```

## Installing in a remote (WSL, SSH, Dev Containers)

The extension declares `extensionKind: ["workspace"]`, so it runs in the
workspace extension host — i.e. **inside** the WSL distro / SSH remote / dev
container, not on your local machine. That's where the agent CLI gets spawned
and where the agent's working directory lives.

Three ways to install it remotely:

1. **From the marketplace** (once published): connect to the remote, open the
   Extensions view, search for *Agent Panel*, and click **Install in WSL:
   \<distro\>** (or the equivalent for your remote).
2. **From a local install**: install the extension locally first, then connect
   to your remote — VS Code prompts you to install it on the remote side too.
3. **Sideloading a `.vsix`** without publishing: build a package
   (`npx @vscode/vsce package`) and from a terminal *inside the remote* run
   `code --install-extension /path/to/agent-panel-0.2.0.vsix`. Or use the
   Extensions view's **⋯ → Install from VSIX...** while focused on the remote.

For native Windows or native Linux/macOS (no remote), there's nothing special
to do — the extension installs and runs in the local host.

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

The PTY host runs as a separate process. On Windows it is spawned with a
system Node binary to dodge a ConPTY deadlock that hits Electron's bundled
Node; on macOS, Linux, and WSL it uses Electron's Node directly, whose ABI
matches VS Code's bundled `node-pty`. Either way, the host re-uses `node-pty`
shipped inside VS Code's `app.asar.unpacked`, so the extension itself does not
bundle native modules.

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
