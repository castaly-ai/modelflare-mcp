import path from 'node:path'

import {
  KEYS_URL,
  ModelDirectory,
  ModelflareClient,
  ModelflareError,
  createVideo,
  describeError,
  downloadVideo,
  generateImage,
  getVideo,
  isModelflareError,
  modelDocsUrl,
  signUpUrl,
  waitForVideo,
  type ClassifiedModel,
  type Locale,
  type ModelKind,
} from '@modelflare/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { OutputDirectory, extensionFor } from './output.js'

const VERSION = __MODELFLARE_PLUGIN_VERSION__
const env = process.env

// Hosts that reuse this server (the Gemini CLI extension) report their own
// attribution and acquisition source.
const ATTRIBUTION_PLUGIN = env.MODELFLARE_SKILL?.trim() || 'modelflare-mcp'
const UTM_SOURCE = env.MODELFLARE_UTM_SOURCE?.trim() || 'mcp-registry'
const LOCALE: Locale = env.MODELFLARE_LOCALE === 'zh' ? 'zh' : 'en'
const output = new OutputDirectory(env.MODELFLARE_OUTPUT_DIR?.trim() || path.join(process.cwd(), 'modelflare-output'))

// Inline images above this size are saved to disk only.
const MAX_INLINE_IMAGE_BASE64 = 1_500_000
const MAX_WAIT_SECONDS = 300

let directory: ModelDirectory | undefined
let client: ModelflareClient | undefined

function requireClient(): ModelflareClient {
  if (client) return client
  const apiKey = env.MODELFLARE_API_KEY?.trim()
  if (!apiKey) {
    throw new ModelflareError({
      kind: 'unauthorized',
      message: `MODELFLARE_API_KEY is not set. Create a Smart API Key at ${KEYS_URL}; no account yet: ${signUpUrl(UTM_SOURCE)}`,
    })
  }
  client = new ModelflareClient({
    apiKey,
    ...(env.MODELFLARE_BASE_URL ? { baseUrl: env.MODELFLARE_BASE_URL } : {}),
    plugin: ATTRIBUTION_PLUGIN,
    version: VERSION,
  })
  return client
}

function requireDirectory(): ModelDirectory {
  directory ??= new ModelDirectory({ client: requireClient() })
  return directory
}

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] }
}

async function failure(error: unknown, modelId?: string): Promise<CallToolResult> {
  if (!isModelflareError(error)) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
  let modelListed: boolean | undefined
  if (error.kind === 'model_not_found' && modelId && client) {
    modelListed = await requireDirectory()
      .isListed(modelId)
      .catch(() => undefined)
  }
  const message =
    error.kind === 'unauthorized' && !client
      ? error.message
      : describeError(error, { locale: LOCALE, utmSource: UTM_SOURCE, ...(modelListed !== undefined ? { modelListed } : {}) })
  return { isError: true, content: [{ type: 'text', text: message }] }
}

async function findModel(id: string, kind: ModelKind): Promise<ClassifiedModel> {
  const snapshot = await requireDirectory().load()
  const model = snapshot.models.find((candidate) => candidate.id === id)
  if (model?.kind === kind) return model
  const hint = model ? `${id} is a ${model.kind} model.` : `${id} is not available to this key.`
  throw new Error(`${hint} Call list_models with kind "${kind}" to see the ${kind} models this key can use.`)
}

const parametersSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Model-specific request fields, sent unchanged. Read the model's docs page (from list_models) for the exact fields.")

const server = new McpServer({ name: 'modelflare', version: VERSION })

server.registerTool(
  'list_models',
  {
    title: 'List Modelflare models',
    description:
      'Lists the models this Modelflare API key can call, with the docs page that holds each media model\'s exact request contract. Defaults to image and video models.',
    inputSchema: {
      kind: z.enum(['image', 'video', 'text']).optional().describe('Only list models of this kind.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ kind }) => {
    try {
      const snapshot = await requireDirectory().load({ force: true })
      const kinds: ModelKind[] = kind ? [kind] : ['image', 'video']
      const rows = snapshot.models
        .filter((model) => kinds.includes(model.kind))
        .map((model) => ({
          id: model.id,
          kind: model.kind,
          ...(model.kind === 'image' || model.kind === 'video' ? { docs: modelDocsUrl(model, LOCALE) } : {}),
        }))
      const note = snapshot.catalogAvailable
        ? ''
        : '\nThe public catalog could not be read, so some image models may be missing from this list.'
      return text(`${JSON.stringify(rows, null, 2)}${note}`)
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'generate_image',
  {
    title: 'Generate or edit an image',
    description:
      'Generates an image, or edits one with edit=true, using a Modelflare image model, and saves the result to the output directory. Billed to the Modelflare balance by actual usage.',
    inputSchema: {
      model: z.string().min(1).describe('Image model ID from list_models.'),
      prompt: z.string().min(1),
      parameters: parametersSchema,
      edit: z.boolean().optional().describe('Use the edits route (OpenAI-compatible image models only).'),
    },
    annotations: { openWorldHint: true },
  },
  async ({ model: modelId, prompt, parameters, edit }) => {
    try {
      const model = await findModel(modelId, 'image')
      const images = await generateImage(requireClient(), {
        model,
        prompt,
        ...(parameters ? { parameters } : {}),
        ...(edit ? { edit } : {}),
      })
      const saved: string[] = []
      const content: CallToolResult['content'] = []
      for (const image of images) {
        if (image.base64) {
          const mimeType = image.mimeType ?? 'image/png'
          saved.push(await output.saveBytes(model.id, extensionFor(mimeType, 'png'), Buffer.from(image.base64, 'base64')))
          if (image.base64.length <= MAX_INLINE_IMAGE_BASE64) content.push({ type: 'image', data: image.base64, mimeType })
        } else if (image.url) {
          // Result URLs expire, so keep a local copy right away.
          const response = await fetch(image.url)
          if (!response.ok) throw new Error(`Could not download the generated image (HTTP ${response.status})`)
          saved.push(await output.saveResponse(model.id, 'png', response))
        }
      }
      content.unshift({ type: 'text', text: `Saved ${saved.length} image(s):\n${saved.join('\n')}` })
      return { content }
    } catch (error) {
      return failure(error, modelId)
    }
  },
)

server.registerTool(
  'create_video',
  {
    title: 'Create a video task',
    description:
      'Starts an asynchronous Modelflare video task and returns its task ID. Poll with get_video_status and save with download_video. Billed to the Modelflare balance by actual usage.',
    inputSchema: {
      model: z.string().min(1).describe('Video model ID from list_models.'),
      request: z
        .record(z.string(), z.unknown())
        .describe("Request body from the model's docs page (from list_models). The model field is set from the model argument."),
    },
    annotations: { openWorldHint: true },
  },
  async ({ model: modelId, request }) => {
    try {
      const model = await findModel(modelId, 'video')
      const task = await createVideo(requireClient(), { ...request, model: model.id })
      return text(JSON.stringify({ task_id: task.id, status: task.status }, null, 2))
    } catch (error) {
      return failure(error, modelId)
    }
  },
)

server.registerTool(
  'get_video_status',
  {
    title: 'Get video task status',
    description: 'Returns the status and progress of a Modelflare video task.',
    inputSchema: { task_id: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ task_id: taskId }) => {
    try {
      const task = await getVideo(requireClient(), taskId)
      return text(JSON.stringify(task, null, 2))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'download_video',
  {
    title: 'Download a finished video',
    description:
      'Saves a completed Modelflare video to the output directory. Optionally waits for the task first. Result URLs expire, so download soon after completion.',
    inputSchema: {
      task_id: z.string().min(1),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_SECONDS)
        .optional()
        .describe(`Wait up to this many seconds for the task to finish (max ${MAX_WAIT_SECONDS}).`),
    },
    annotations: { openWorldHint: true },
  },
  async ({ task_id: taskId, wait_seconds: waitSeconds }) => {
    try {
      const activeClient = requireClient()
      let task = await getVideo(activeClient, taskId)
      if (task.status !== 'completed' && task.status !== 'failed' && waitSeconds) {
        try {
          task = await waitForVideo(activeClient, taskId, { timeoutMs: waitSeconds * 1000 })
        } catch (error) {
          if (!(isModelflareError(error) && error.kind === 'timeout')) throw error
          task = await getVideo(activeClient, taskId)
        }
      }
      if (task.status !== 'completed') {
        const reason = task.status === 'failed' ? `: ${task.error?.message ?? 'the task failed'}` : '; try again later'
        return { isError: task.status === 'failed', content: [{ type: 'text', text: `Task ${taskId} is ${task.status}${reason}.` }] }
      }
      const file = await output.saveResponse(task.model ?? taskId, 'mp4', await downloadVideo(activeClient, taskId))
      return text(`Saved video: ${file}`)
    } catch (error) {
      return failure(error)
    }
  },
)

await server.connect(new StdioServerTransport())
