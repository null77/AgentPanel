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

    // Load WebGL renderer (same as VS Code's terminal) for better glyph rendering
    if (WebglAddonCtor) {
        try {
            var webglAddon = new WebglAddonCtor();
            terminal.loadAddon(webglAddon);
        } catch (e) {
            // WebGL not available, fall back to canvas renderer
        }
    }

    // Fit after a small delay to ensure layout is settled
    setTimeout(function () {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
    }, 50);

    // Forward user input to extension host
    terminal.onData(function (data) {
        vscode.postMessage({ type: 'input', data: data });
    });

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
            case 'exit':
                exitMessage.textContent =
                    'Process exited' +
                    (message.exitCode !== undefined ? ' (code ' + message.exitCode + ')' : '');
                exitOverlay.classList.add('visible');
                break;
        }
    });

    // Handle resize
    var resizeObserver = new ResizeObserver(function () {
        try {
            fitAddon.fit();
            var dims = fitAddon.proposeDimensions();
            if (dims) {
                vscode.postMessage({
                    type: 'resize',
                    cols: dims.cols,
                    rows: dims.rows,
                });
            }
        } catch (e) {
            // Fit can throw if terminal not yet visible
        }
    });
    resizeObserver.observe(container);

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

    // Signal ready with initial dimensions
    setTimeout(function () {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
        var dims = null;
        try { dims = fitAddon.proposeDimensions(); } catch (e) { /* ignore */ }
        vscode.postMessage({
            type: 'ready',
            cols: dims ? dims.cols : 80,
            rows: dims ? dims.rows : 24,
        });
    }, 200);
})();
