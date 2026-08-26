import { defineConfig } from 'tsdown'

/**
 * Browser half bundle: a lazy-CJS factory registered into the client module
 * loader (window.__ModuleLoader__.load({ id, factory })). The wrapper format
 * mirrors the published dsh client packages (see dsh-client-modules README):
 * the factory receives the loader's synchronous `require`, externals stay
 * loader-table lookups (react baseline + declared dsh.client.inject rows),
 * and all side effects live inside the factory closure.
 */
export default defineConfig({
  entry: ['src/client/index.ts'],
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  minify: false,
  clean: false,
  external: ['react', 'react-dom', 'react-dom/client', /^@deepseek-ai\//],
  outputOptions: {
    entryFileNames: 'client.js',
  },
  banner: [
    'window.__ModuleLoader__.load({',
    '\tid: "@starwish-ai/dsh",',
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  ].join('\n'),
  footer: [
    '\t\texports.apply = apply;',
    '\t\texports.inject = inject;',
    '\t\treturn module.exports;',
    '\t}',
    '});',
  ].join('\n'),
})
