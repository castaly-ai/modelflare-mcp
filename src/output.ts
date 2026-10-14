import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export function extensionFor(mimeType: string | null | undefined, fallback: string): string {
  const base = mimeType?.split(';')[0]?.trim().toLowerCase()
  return (base && EXTENSIONS[base]) || fallback
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'output'
}

export class OutputDirectory {
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  #fileName(stem: string, extension: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    return path.join(this.root, `${safeName(stem)}-${stamp}.${extension}`)
  }

  async saveBytes(stem: string, extension: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.root, { recursive: true })
    const file = this.#fileName(stem, extension)
    await writeFile(file, bytes)
    return file
  }

  async saveResponse(stem: string, fallbackExtension: string, response: Response): Promise<string> {
    if (!response.body) throw new Error('The download has no body')
    await mkdir(this.root, { recursive: true })
    const file = this.#fileName(stem, extensionFor(response.headers.get('content-type'), fallbackExtension))
    await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(file))
    return file
  }
}
