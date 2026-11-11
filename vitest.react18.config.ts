import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const optimization = {
  enabled: true,
  include: ['react18', 'react-dom', 'react-dom/client', 'react-dom/server'],
  // Vitest excludes "react" from optimization. Resolve the renderer's CJS
  // require to the alias before that exclusion, so it shares React 18 too.
  esbuildOptions: { plugins: [{ name: 'react18-peer', setup(build: any) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react18') }));
  } }] },
};
export default defineConfig({
  resolve: { alias: [
    { find: /^react-dom\/server$/, replacement: require.resolve('react-dom18/server') },
    { find: /^react-dom\/client$/, replacement: require.resolve('react-dom18/client') },
    { find: /^react-dom$/, replacement: require.resolve('react-dom18') },
    { find: /^react$/, replacement: 'react18' },
  ] },
  test: { include: ['tests/react.*.test.ts'], setupFiles: ['tests/react18.setup.ts'], deps: { optimizer: { client: optimization, ssr: optimization } } },
});
