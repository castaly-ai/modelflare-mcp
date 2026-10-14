#!/usr/bin/env node
// Builds modelflare-mcp-<version>.mcpb, an MCP Bundle (desktop extension) that
// Claude Desktop installs directly and Smithery distributes as a local stdio
// server. The server and all of its dependencies are bundled into one file, so
// the bundle needs no node_modules.
import { execFileSync, spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const stage = path.join(root, 'mcpb-build')
const output = path.join(root, `modelflare-mcp-${pkg.version}.mcpb`)

await rm(stage, { recursive: true, force: true })
await mkdir(path.join(stage, 'server'), { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(stage, 'server/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bundled CommonJS dependencies still call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  alias: { '@modelflare/core': path.join(root, './shared/core-ts/src/index.ts') },
  define: { __MODELFLARE_PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
})

// The tool list shown by clients comes from the built server itself.
async function listTools() {
  const child = spawn(process.execPath, [path.join(stage, 'server/index.mjs')], {
    env: { ...process.env, MODELFLARE_API_KEY: 'listing-tools-only' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'build-mcpb', version: pkg.version } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]
  child.stdin.write(messages.map((message) => JSON.stringify(message)).join('\n') + '\n')
  let buffer = ''
  try {
    for await (const chunk of child.stdout) {
      buffer += chunk
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if (message.id === 2) return message.result.tools.map((tool) => ({ name: tool.name, description: tool.description }))
      }
    }
  } finally {
    child.kill()
  }
  throw new Error('The built server did not answer tools/list.')
}

const manifest = {
  manifest_version: '0.3',
  name: 'modelflare-mcp',
  display_name: 'Modelflare',
  version: pkg.version,
  description: 'List your Modelflare models and generate images and videos with one Smart API Key.',
  long_description:
    'One Modelflare Smart API Key calls every image, video and text model available to your account. The server lists your models with each media model\'s docs page, generates images, starts and polls video tasks, and saves the results to a folder you choose.',
  author: { name: 'Modelflare', email: 'support@modelflare.dev', url: 'https://modelflare.dev' },
  homepage: 'https://modelflare.dev',
  documentation: 'https://docs.modelflare.dev',
  support: 'https://github.com/castaly-ai/modelflare-mcp/issues',
  repository: { type: 'git', url: 'https://github.com/castaly-ai/modelflare-mcp' },
  icon: 'icon.png',
  license: 'MIT',
  keywords: ['modelflare', 'image generation', 'video generation', 'ai models'],
  privacy_policies: ['https://modelflare.dev/privacy-policy'],
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: {
        MODELFLARE_API_KEY: '${user_config.api_key}',
        MODELFLARE_BASE_URL: '${user_config.base_url}',
        MODELFLARE_OUTPUT_DIR: '${user_config.output_dir}',
        MODELFLARE_UTM_SOURCE: 'smithery',
      },
    },
  },
  tools: await listTools(),
  user_config: {
    api_key: {
      type: 'string',
      title: 'Modelflare API key',
      description: 'A Smart API Key calls every model available to your account. Create one at https://modelflare.dev/keys',
      sensitive: true,
      required: true,
    },
    base_url: {
      type: 'string',
      title: 'Base URL',
      description: '"global" (https://modelflare.dev/v1), "china" (https://origin.modelflare.dev/v1), or a custom URL. Leave empty for global.',
      required: false,
      default: 'global',
    },
    output_dir: {
      type: 'directory',
      title: 'Output folder',
      description: 'Where generated images and videos are saved.',
      required: false,
      default: '${DOWNLOADS}/Modelflare',
    },
  },
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=20.0.0' } },
}

await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await copyFile(path.join(root, './shared/brand/icon-512.png'), path.join(stage, 'icon.png'))
await copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'))
await copyFile(path.join(root, 'README.md'), path.join(stage, 'README.md'))

execFileSync('npx', ['-y', MCPB_CLI, 'validate', path.join(stage, 'manifest.json')], { stdio: 'inherit' })
execFileSync('npx', ['-y', MCPB_CLI, 'pack', stage, output], { stdio: 'inherit' })
console.log(`Built ${path.relative(root, output)} with ${manifest.tools.length} tools`)
