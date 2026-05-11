// Standalone process that hosts node-pty.
// Spawned as a child process (using system Node.js, NOT Electron) to avoid
// ConPTY deadlock in the VS Code extension host.
// Communicates with the parent via IPC (process.send / process.on('message')).

process.send({ type: 'log', text: 'ptyHost starting, pid=' + process.pid + ', execPath=' + process.execPath });

const nodePtyPath = process.argv[2];
if (!nodePtyPath) {
    process.send({ type: 'error', message: 'No node-pty path provided' });
    process.exit(1);
}

process.send({ type: 'log', text: 'Loading node-pty from: ' + nodePtyPath });

let nodePty;
try {
    nodePty = require(nodePtyPath);
} catch (err) {
    process.send({ type: 'error', message: 'Failed to load node-pty from ' + nodePtyPath + ': ' + err.message + '\n' + err.stack });
    process.exit(1);
}

process.send({ type: 'log', text: 'node-pty loaded, spawn type: ' + typeof nodePty.spawn });
process.send({ type: 'ready' });

let pty = null;
// Holds the latest resize that arrived before pty was spawned; applied
// immediately after spawn so an early post-animation resize from the
// webview isn't silently dropped.
let pendingResize = null;

process.on('message', (msg) => {
    switch (msg.type) {
        case 'spawn': {
            process.send({ type: 'log', text: 'spawn command received: ' + msg.file + ' ' + (msg.args || []).join(' ') });
            process.send({ type: 'log', text: 'spawn options: cols=' + msg.options.cols + ' rows=' + msg.options.rows + ' cwd=' + msg.options.cwd });
            process.send({ type: 'log', text: 'calling nodePty.spawn()...' });
            try {
                // If a resize was buffered while we were still loading, fold
                // it into the spawn options so the pty starts at the right
                // size in one step.
                if (pendingResize) {
                    msg.options.cols = pendingResize.cols;
                    msg.options.rows = pendingResize.rows;
                    pendingResize = null;
                }
                pty = nodePty.spawn(msg.file, msg.args, msg.options);
                process.send({ type: 'log', text: 'nodePty.spawn() returned, pid=' + pty.pid });
                process.send({ type: 'spawned', pid: pty.pid });

                pty.onData((data) => {
                    try {
                        process.send({ type: 'data', data });
                    } catch (e) {
                        // Parent may have disconnected
                    }
                });

                pty.onExit((e) => {
                    try {
                        process.send({ type: 'exit', exitCode: e.exitCode, signal: e.signal });
                    } catch (err) {
                        // Parent may have disconnected
                    }
                    pty = null;
                });
            } catch (err) {
                process.send({ type: 'error', message: 'spawn failed: ' + err.message + '\n' + err.stack });
            }
            break;
        }
        case 'input': {
            if (pty) {
                pty.write(msg.data);
            }
            break;
        }
        case 'resize': {
            if (pty) {
                try {
                    pty.resize(msg.cols, msg.rows);
                } catch (e) {
                    // Resize can fail if process exited
                }
            } else {
                // Buffer until spawn; otherwise the resize that fixes the
                // first-load size mismatch gets silently dropped while the
                // ptyHost is still loading node-pty.
                pendingResize = { cols: msg.cols, rows: msg.rows };
            }
            break;
        }
        case 'kill': {
            if (pty) {
                try {
                    pty.kill();
                } catch (e) {
                    // Already dead
                }
                pty = null;
            }
            break;
        }
        case 'shutdown': {
            if (pty) {
                try { pty.kill(); } catch (e) { /* */ }
                pty = null;
            }
            process.exit(0);
            break;
        }
    }
});

process.on('disconnect', () => {
    if (pty) {
        try { pty.kill(); } catch (e) { /* */ }
    }
    process.exit(0);
});
