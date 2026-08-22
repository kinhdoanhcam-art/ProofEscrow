import * as esbuild from 'esbuild'

// Resolve the `?raw` contract import to a stub so genlayer.ts can be bundled
// outside Vite.
const rawStub = {
  name: 'raw-stub',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: args.path, namespace: 'raw-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'raw-stub' }, () => ({
      contents: 'export default "# stub contract source"',
      loader: 'js',
    }))
  },
}

await esbuild.build({
  entryPoints: ['src/lib/genlayer.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'tests/.genlayer.mjs',
  plugins: [rawStub],
  logLevel: 'warning',
})
