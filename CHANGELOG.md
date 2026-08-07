# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-07

First release published to the Visual Studio Marketplace. The settings surface
(`agentPanel.agents`, `agentPanel.defaultAgent`, `agentPanel.hiddenBuiltins`)
and the command ids are considered stable from here on.

### Added

- `~` (home directory) and `${env:VAR}` substitutions in `agentPanel.agents`
  `env` values, so users can write `"CLAUDE_CONFIG_DIR": "~/.claude-work"`
  without expanding the path manually. Enables the work / personal Claude
  Code profile pattern documented in the README.
- OSC 52 clipboard support, so programs running inside the agent (OpenCode,
  tmux) can copy to the system clipboard.
- Copy the selection with `Ctrl+Shift+C` / `Cmd+C`.
- All commands are grouped under an **Agent Panel** category in the command
  palette, matching what the README documents.
- Marketplace icon and gallery metadata.

### Changed

- The agent spawns at the panel's real size. A `ResizeObserver` drives the
  ready/resize flow instead of a fixed timer, replacing the 80x24 fallback
  that the first load used to start at. Resize messages that arrive before
  the PTY exists are buffered and folded into the spawn options rather than
  being dropped.

### Fixed

- Multi-line paste. Clipboard text is routed through xterm's paste path, which
  wraps it in bracketed-paste markers when the agent has enabled that mode and
  normalizes newlines to CR. Previously the text was written straight to the
  PTY, so each newline submitted a partial prompt and the agent looked hung.
- Large pastes are sent in ~4KB chunks with a yield between each, so the
  webview can interleave rendering. A multi-KB paste used to starve the render
  loop and the panel appeared frozen.
- Keystrokes falling through to VS Code shortcuts. Refocusing the panel left
  the iframe focused but xterm's hidden textarea not, so Alt-keys opened the
  menubar instead of reaching the agent.
- The panel no longer grabs focus back when VS Code regains OS focus. Clicking
  into another view (e.g. the integrated terminal) and alt-tabbing away and
  back now leaves focus where you put it.
- A double-paste regression where both the host round-trip and xterm's native
  paste fired for the same `Ctrl+V`.

### Internal

- `npm run typecheck` (`tsc --noEmit`) now runs as part of `vscode:prepublish`.
  Adding the missing `@types/node` dev dependency was required to make the
  tree typecheck at all.

## [0.2.0] - 2026-04-28

Renamed and generalized from `claude-code-panel` to `agent-panel`.

### Added

- Multi-agent support. Built-in agents Claude Code (`claude`) and OpenCode
  (`opencode`); switch with the **Switch Agent** button in the view title bar
  or via the `Agent Panel: Switch Agent` command.
- `agentPanel.agents` setting to define custom agent CLIs (or override the
  built-ins) without touching code; `args`, `env`, `icon` per agent.
- `agentPanel.defaultAgent` and `agentPanel.hiddenBuiltins` settings.
- Active agent persists across reloads (workspace state) and across
  workspaces (global state fallback).
- `extensionKind: ["workspace"]` so the extension installs into the workspace
  extension host on Remote-WSL, Remote-SSH, and Dev Containers.
- Switch Agent button on the exit overlay: when an agent fails to launch you
  can pick a different one without hunting for the title-bar control.

### Changed

- Off-Windows (macOS, Linux, WSL) now forks the PTY host with Electron's
  bundled Node, which guarantees ABI match with VS Code's `node-pty`. No
  system Node required on those platforms. Windows still uses a system Node
  binary to dodge the ConPTY deadlock that hits Electron's Node.
- Binary lookup uses `cp.execFileSync` (not `execSync`) so user-supplied
  agent commands cannot be shell-interpolated.

### Breaking

- Extension id, view container id, view id, and all command ids renamed from
  `claudeCodePanel.*` to `agentPanel.*`. Pinned panel positions and
  keybindings tied to the old ids must be re-pointed. There is no automated
  migration — VS Code does not expose an API to move views between
  containers.

## [0.1.0]

Initial release as `claude-code-panel`. Dedicated bottom-panel tab for the
Claude Code CLI; theme/font sync with VS Code's terminal; out-of-process PTY
host to work around the Windows ConPTY deadlock.
