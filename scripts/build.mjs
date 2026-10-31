import { build } from 'vite';

await build();

// Content scripts need a self-contained classic script; the worker supports ESM.
for (const [name, format] of [
  ['background', 'es'],
  ['content', 'iife'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      target: 'chrome116',
      emptyOutDir: false,
      lib: {
        entry: `src/${name}/index.ts`,
        name: `Scope${name}`,
        formats: [format],
        fileName: () => `${name}.js`,
      },
    },
  });
}
