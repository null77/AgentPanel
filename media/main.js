// @ts-nocheck
(function () {
    var errorDisplay = document.getElementById('error-display');
    function showError(msg) {
        if (errorDisplay) {
            errorDisplay.style.display = 'block';
            errorDisplay.textContent += msg + '\n';
        }
    }

    try {
        var vscode = acquireVsCodeApi();
    } catch (e) {
        showError('Failed to acquire VS Code API: ' + e.message);
        return;
    }

    // Resolve Terminal and FitAddon - handle both global and module.exports paths
    var TerminalCtor = window.Terminal;
    if (!TerminalCtor && typeof module !== 'undefined' && module.exports) {
        TerminalCtor = module.exports.Terminal;
    }
    if (!TerminalCtor) {
        showError('xterm.js Terminal class not found on window.Terminal. Available globals: ' +
            Object.keys(window).filter(function(k) { return k[0] === k[0].toUpperCase() && k.length > 2; }).join(', '));
        return;
    }

    var FitAddonCtor = window.FitAddon && window.FitAddon.FitAddon;
    if (!FitAddonCtor) {
        showError('FitAddon not found. window.FitAddon = ' + typeof window.FitAddon);
        return;
    }

    var WebglAddonCtor = window.WebglAddon && window.WebglAddon.WebglAddon;

    // Read VS Code CSS variables for theme colors
    function getThemeColors() {
        var style = getComputedStyle(document.documentElement);
        function get(varName, fallback) {
            return style.getPropertyValue(varName).trim() || fallback;
        }
        return {
            background: get('--vscode-terminal-background', get('--vscode-panel-background', '#1e1e1e')),
            foreground: get('--vscode-terminal-foreground', get('--vscode-foreground', '#cccccc')),
            cursor: get('--vscode-terminalCursor-foreground', '#ffffff'),
            cursorAccent: get('--vscode-terminalCursor-background', '#000000'),
            selectionBackground: get('--vscode-terminal-selectionBackground', '#264f78'),
            black: get('--vscode-terminal-ansiBlack', '#000000'),
            red: get('--vscode-terminal-ansiRed', '#cd3131'),
            green: get('--vscode-terminal-ansiGreen', '#0dbc79'),
            yellow: get('--vscode-terminal-ansiYellow', '#e5e510'),
            blue: get('--vscode-terminal-ansiBlue', '#2472c8'),
            magenta: get('--vscode-terminal-ansiMagenta', '#bc3fbc'),
            cyan: get('--vscode-terminal-ansiCyan', '#11a8cd'),
            white: get('--vscode-terminal-ansiWhite', '#e5e5e5'),
            brightBlack: get('--vscode-terminal-ansiBrightBlack', '#666666'),
            brightRed: get('--vscode-terminal-ansiBrightRed', '#f14c4c'),
            brightGreen: get('--vscode-terminal-ansiBrightGreen', '#23d18b'),
            brightYellow: get('--vscode-terminal-ansiBrightYellow', '#f5f543'),
            brightBlue: get('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
            brightMagenta: get('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
            brightCyan: get('--vscode-terminal-ansiBrightCyan', '#29b8db'),
            brightWhite: get('--vscode-terminal-ansiBrightWhite', '#e5e5e5'),
        };
    }

    var colors = getThemeColors();

    // Use a sensible default; the extension host will send the real
    // VS Code terminal font via setTheme shortly after init.
    var defaultFont = getComputedStyle(document.documentElement)
        .getPropertyValue('--vscode-editor-font-family').trim();

    var terminal = new TerminalCtor({
        cursorBlink: true,
        cursorStyle: 'block',
        customGlyphs: true,
        fontFamily: defaultFont || 'monospace',
        fontSize: 14,
        lineHeight: 1.0,
        theme: {
            background: colors.background,
            foreground: colors.foreground,
            cursor: colors.cursor,
            cursorAccent: colors.cursorAccent,
            selectionBackground: colors.selectionBackground,
            black: colors.black,
            red: colors.red,
            green: colors.green,
            yellow: colors.yellow,
            blue: colors.blue,
            magenta: colors.magenta,
            cyan: colors.cyan,
            white: colors.white,
            brightBlack: colors.brightBlack,
            brightRed: colors.brightRed,
            brightGreen: colors.brightGreen,
            brightYellow: colors.brightYellow,
            brightBlue: colors.brightBlue,
            brightMagenta: colors.brightMagenta,
            brightCyan: colors.brightCyan,
            brightWhite: colors.brightWhite,
        },
        allowProposedApi: true,
    });

    var fitAddon = new FitAddonCtor();
    terminal.loadAddon(fitAddon);

    var container = document.getElementById('terminal-container');
    var exitOverlay = document.getElementById('exit-overlay');
    var exitMessage = document.getElementById('exit-message');
    var restartBtn = document.getElementById('restart-btn');
    var switchBtn = document.getElementById('switch-btn');

    terminal.open(container);

    // Focus restoration. When VS Code regains OS focus or the panel becomes
    // visible, the iframe receives focus but xterm's hidden textarea does
    // not — so keystrokes fall through to VS Code's window shortcut handler
    // (Alt-key opens the menu, etc). Forward focus into xterm in every case
    // we can detect.
    function focusTerminal() {
        try { terminal.focus(); } catch (e) { /* terminal not yet ready */ }
    }
    window.addEventListener('focus', focusTerminal);
    // mousedown fires before the default focus shift; ensures clicking
    // anywhere in the container (including padding) lands focus on xterm.
    container.addEventListener('mousedown', focusTerminal);

    // Load WebGL renderer (same as VS Code's terminal) for better glyph rendering
    if (WebglAddonCtor) {
        try {
            var webglAddon = new WebglAddonCtor();
            terminal.loadAddon(webglAddon);
        } catch (e) {
            // WebGL not available, fall back to canvas renderer
        }
    }

    // Forward user input to extension host
    terminal.onData(function (data) {
        vscode.postMessage({ type: 'input', data: data });
    });

    // OSC 52 — programs running inside the terminal (e.g. OpenCode, tmux) can
    // emit "ESC ] 52 ; <clip> ; <base64> BEL" to request a clipboard write.
    // xterm.js parses it but does NOT wire to the system clipboard by default,
    // so we register a handler that decodes and forwards to the host.
    if (terminal.parser && terminal.parser.registerOscHandler) {
        terminal.parser.registerOscHandler(52, function (data) {
            var sep = data.indexOf(';');
            if (sep < 0) { return false; }
            var payload = data.slice(sep + 1);
            if (!payload || payload === '?') {
                // Empty or read-back query — ignore (don't leak clipboard contents).
                return true;
            }
            try {
                var binary = atob(payload);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                var text = new TextDecoder('utf-8').decode(bytes);
                vscode.postMessage({ type: 'copy', data: text });
                return true;
            } catch (e) {
                return false;
            }
        });
    }

    // Copy shortcut:
    //   Win/Linux: Ctrl+Shift+C
    //   macOS:     Cmd+C
    // Plain Ctrl+C is left as interrupt — we only intercept the copy combo
    // when there's a selection; other keys pass through unchanged.
    var isMac = navigator.platform.indexOf('Mac') === 0;
    // Tracks the most recent keyboard-paste request so the window-level
    // paste listener can skip if the browser also dispatches a `paste`
    // event for the same keystroke (avoids double-paste).
    var pasteRequestedAt = 0;
    terminal.attachCustomKeyEventHandler(function (e) {
        if (e.type !== 'keydown') { return true; }
        var key = e.key.toLowerCase();

        if (key === 'c') {
            var isCopy = isMac
                ? (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey)
                : (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey);
            if (isCopy) {
                var sel = terminal.getSelection();
                if (sel) {
                    vscode.postMessage({ type: 'copy', data: sel });
                    e.preventDefault();
                    return false;
                }
            }
            return true;
        }

        if (key === 'v') {
            // VS Code's webview keybinding layer can swallow the native
            // `paste` event before the textarea sees it. Detect the paste
            // combo ourselves and round-trip through the extension host,
            // which reads vscode.env.clipboard and posts the text back.
            var isPaste = isMac
                ? (e.metaKey && !e.ctrlKey && !e.altKey)
                : ((e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) ||
                   (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey));
            if (isPaste) {
                pasteRequestedAt = Date.now();
                vscode.postMessage({ type: 'requestPaste' });
                e.preventDefault();
                return false;
            }
            return true;
        }

        return true;
    });

    // Paste handler — covers Ctrl+V, Ctrl+Shift+V, Cmd+V, and right-click
    // paste in one place. We capture the paste event before xterm's hidden
    // textarea sees it, forward the text as terminal input, and
    // preventDefault so xterm's built-in paste handler doesn't ALSO write
    // the same bytes. Without this, intercepting Ctrl+V via keydown caused
    // a double paste (our requestPaste round-trip + xterm's native paste
    // both fired).
    window.addEventListener('paste', function (e) {
        // Skip if the keyboard handler just fired requestPaste for this
        // same paste action — otherwise we'd inject the clipboard twice.
        if (Date.now() - pasteRequestedAt < 200) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        var text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (text) {
            vscode.postMessage({ type: 'input', data: text });
        }
        e.preventDefault();
        e.stopPropagation();
    }, true);

    // Handle messages from extension host
    window.addEventListener('message', function (event) {
        var message = event.data;
        switch (message.type) {
            case 'output':
                terminal.write(message.data);
                break;
            case 'clear':
                terminal.clear();
                terminal.reset();
                exitOverlay.classList.remove('visible');
                break;
            case 'setTheme':
                if (message.fontFamily) {
                    terminal.options.fontFamily = message.fontFamily;
                }
                if (message.fontSize > 0) {
                    terminal.options.fontSize = message.fontSize;
                }
                if (message.lineHeight > 0) {
                    terminal.options.lineHeight = message.lineHeight;
                }
                // Re-read CSS variables in case VS Code theme changed
                var newColors = getThemeColors();
                terminal.options.theme = {
                    background: newColors.background,
                    foreground: newColors.foreground,
                    cursor: newColors.cursor,
                    cursorAccent: newColors.cursorAccent,
                    selectionBackground: newColors.selectionBackground,
                    black: newColors.black,
                    red: newColors.red,
                    green: newColors.green,
                    yellow: newColors.yellow,
                    blue: newColors.blue,
                    magenta: newColors.magenta,
                    cyan: newColors.cyan,
                    white: newColors.white,
                    brightBlack: newColors.brightBlack,
                    brightRed: newColors.brightRed,
                    brightGreen: newColors.brightGreen,
                    brightYellow: newColors.brightYellow,
                    brightBlue: newColors.brightBlue,
                    brightMagenta: newColors.brightMagenta,
                    brightCyan: newColors.brightCyan,
                    brightWhite: newColors.brightWhite,
                };
                try { fitAddon.fit(); } catch (e) { /* ignore */ }
                break;
            case 'focus':
                focusTerminal();
                break;
            case 'exit':
                exitMessage.textContent =
                    'Process exited' +
                    (message.exitCode !== undefined ? ' (code ' + message.exitCode + ')' : '');
                exitOverlay.classList.add('visible');
                break;
        }
    });

    // xterm.onResize is the source of truth for dims sent to the host. It
    // fires whenever the terminal's cell grid changes — from a container
    // resize via fit(), from a font/size change in setTheme, or any future
    // cause. Routing everything through one path keeps the PTY in sync with
    // whatever xterm is actually rendering. (Previously: setTheme called
    // fit() but never sent the new dims, so after a font change the PTY
    // stayed at the old size and the panel looked mis-sized until the user
    // dragged the panel separator to trigger a container resize.)
    var hasSentReady = false;
    var lastCols = 0;
    var lastRows = 0;

    function sendDims(cols, rows) {
        if (!cols || !rows) { return; }
        if (!hasSentReady) {
            hasSentReady = true;
            lastCols = cols;
            lastRows = rows;
            vscode.postMessage({ type: 'ready', cols: cols, rows: rows });
            return;
        }
        if (cols !== lastCols || rows !== lastRows) {
            lastCols = cols;
            lastRows = rows;
            vscode.postMessage({ type: 'resize', cols: cols, rows: rows });
        }
    }

    terminal.onResize(function (dims) {
        sendDims(dims.cols, dims.rows);
    });

    var resizeObserver = new ResizeObserver(function () {
        try {
            fitAddon.fit();
        } catch (e) {
            return;  // terminal not yet visible/attached
        }
        // fit() calls terminal.resize() only if dims changed → onResize
        // fires → sendDims runs. But if fit() produced the same dims as the
        // current terminal (common on the very first observation, since
        // xterm initializes at the default 80x24), onResize does NOT fire.
        // Push ready directly in that case so we don't get stuck waiting.
        if (!hasSentReady) {
            var dims = fitAddon.proposeDimensions();
            if (dims) { sendDims(dims.cols, dims.rows); }
        }
    });
    resizeObserver.observe(container);

    // Backup: if the panel is collapsed at startup the observer never fires
    // with a non-zero size. Send a default 'ready' after 1.5s so the agent
    // still spawns; the observer will send a 'resize' once the panel opens.
    setTimeout(function () {
        if (!hasSentReady) {
            hasSentReady = true;
            vscode.postMessage({ type: 'ready', cols: 80, rows: 24 });
        }
    }, 1500);

    // Restart button
    restartBtn.addEventListener('click', function () {
        exitOverlay.classList.remove('visible');
        vscode.postMessage({ type: 'requestRestart' });
    });

    // Switch Agent button
    if (switchBtn) {
        switchBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'requestSwitchAgent' });
        });
    }
})();
