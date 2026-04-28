# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
