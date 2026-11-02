import { build } from 'vite';
import { copyFile } from 'node:fs/promises';

await build();
// Keep the provided logo as the single source; Chrome scales the packaged PNG.
await copyFile(
  new URL('../logo.png', import.meta.url),
  new URL('../dist/logo.png', import.meta.url),
);

// Content scripts need a self-contained classic script; the worker supports ESM.
for (const [name, format] of [
  ['background', 'es'],
  ['content', 'iife'],
  ['injected', 'iife'],
  ['reload-content', 'iife'],
  ['reload-injected', 'iife'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      target: 'chrome116',
      emptyOutDir: false,
      lib: {
        entry: `src/${name}/index.ts`,
        name: `Scope${name.replaceAll('-', '_')}`,
        formats: [format],
        fileName: () => `${name}.js`,
      },
    },
  });
}
