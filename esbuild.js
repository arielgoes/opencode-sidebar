const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Emits the messages VS Code's $esbuild-watch problem matcher needs to detect build completion.
const watchPlugin = {
  name: 'watch-notify',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
  plugins: watch ? [watchPlugin] : [],
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'esm',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview/main.js',
  logLevel: 'silent',
  plugins: watch ? [watchPlugin] : [],
};

async function main() {
  const [extCtx, wvCtx] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  if (watch) {
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log('[esbuild] watching extension + webview');
  } else {
    await Promise.all([extCtx.rebuild(), wvCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), wvCtx.dispose()]);
    console.log('[esbuild] built extension + webview');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
