const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !isProduction,
    minify: isProduction,
    external: ['vscode'],
};

function copyPtyHost() {
    const src = path.join(__dirname, 'src', 'ptyHost.js');
    const dst = path.join(__dirname, 'dist', 'ptyHost.js');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

async function main() {
    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        copyPtyHost();
        console.log('Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        copyPtyHost();
        console.log('Build complete.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
