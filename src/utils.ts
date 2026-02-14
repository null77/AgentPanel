import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Find the path to node-pty module (does NOT load it).
 * The actual require happens in the pty host child process
 * to avoid ConPTY deadlock in the extension host.
 */
export function findNodePtyPath(log: vscode.LogOutputChannel): string {
    const appRoot = vscode.env.appRoot;
    log.info(`VS Code appRoot: ${appRoot}`);

    const candidates = [
        path.join(appRoot, 'node_modules.asar', 'node-pty'),
        path.join(appRoot, 'node_modules.asar.unpacked', 'node-pty'),
        path.join(appRoot, 'node_modules', 'node-pty'),
    ];

    for (const candidate of candidates) {
        // For asar paths, check if the unpacked native binaries exist.
        // For plain paths, check for package.json.
        const probes = candidate.includes('.asar')
            ? [candidate.replace('.asar', '.asar.unpacked') + path.sep + 'build']
            : [candidate + path.sep + 'package.json', candidate + path.sep + 'build'];

        for (const probe of probes) {
            log.info(`Checking: ${candidate} (probe: ${probe})`);
            if (fs.existsSync(probe)) {
                log.info(`Found node-pty at: ${candidate}`);
                return candidate;
            }
        }
    }

    throw new Error(
        'Could not find node-pty. Checked:\n' +
        candidates.map(c => `  - ${c}`).join('\n') +
        '\nEnsure VS Code is a recent version.'
    );
}
