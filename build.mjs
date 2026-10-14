import { chmod, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const outfile = path.join(root, 'dist/index.js')

await build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  // Runtime dependencies are installed from npm; only @modelflare/core is
  // bundled so the package does not depend on this repository.
  external: Object.keys(pkg.dependencies ?? {}).flatMap((name) => [name, `${name}/*`]),
  alias: { '@modelflare/core': path.join(root, './shared/core-ts/src/index.ts') },
  define: { __MODELFLARE_PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
})
await chmod(outfile, 0o755)
