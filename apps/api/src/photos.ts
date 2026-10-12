import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type { Pool } from 'pg'
import sharp from 'sharp'
import { photoJson } from './records.js'
import { InputError, parseUuid } from './validation.js'

const root = process.env.UPLOAD_DIR ?? fileURLToPath(new URL('../../../uploads/', import.meta.url))
const maxBytes = 15 * 1024 * 1024
const types = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const

export async function processImage(original: Buffer) {
  if (original.length > maxBytes) throw new InputError({ files: '1枚15 MiB以内にしてください' })
  let metadata
  try {
    metadata = await sharp(original, { failOn: 'error' }).metadata()
  } catch {
    throw new InputError({ files: '有効な画像を指定してください' })
  }
  const mimeType = types[metadata.format as keyof typeof types]
  if (!mimeType || !metadata.width || !metadata.height)
    throw new InputError({ files: 'JPEG、PNG、WebPのみ対応しています' })
  let thumbnail: Buffer
  try {
    thumbnail = await sharp(original, { failOn: 'error' })
      .rotate()
      .resize({
        width: 480,
        height: 480,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer()
  } catch {
    throw new InputError({ files: '画像を読み取れません' })
  }
  return {
    original,
    thumbnail,
    mimeType,
    width: metadata.width,
    height: metadata.height,
  }
}

const filePath = (key: string) => join(root, key)
const photoColumns =
  'id, visit_id, original_filename, mime_type, byte_size, width, height, caption, sort_order, created_at'

export async function recoverPhotoFiles(db: Pool): Promise<void> {
  const rows = await db.query<{
    id: string
    storage_key: string
    thumbnail_key: string | null
  }>('SELECT id, storage_key, thumbnail_key FROM photos')
  const photos = new Map(rows.rows.map((row) => [row.id, row]))
  const referenced = new Set(
    rows.rows.flatMap((row) =>
      [row.storage_key, row.thumbnail_key].filter((key): key is string => !!key),
    ),
  )
  for (const directory of ['original', 'thumbnail', 'pending-delete']) {
    await mkdir(filePath(directory), { recursive: true })
  }
  for (const name of await readdir(filePath('pending-delete'))) {
    const match = /^([0-9a-f-]{36})-(original|thumbnail)$/.exec(name)
    if (!match) continue
    const staged = filePath(`pending-delete/${name}`)
    const row = photos.get(match[1])
    const key = match[2] === 'original' ? row?.storage_key : row?.thumbnail_key
    if (key && referenced.has(key)) await rename(staged, filePath(key))
    else await rm(staged, { force: true })
  }
  for (const directory of ['original', 'thumbnail']) {
    for (const name of await readdir(filePath(directory))) {
      if (!/^[0-9a-f-]{36}(?:\.webp)?$/.test(name)) continue
      const key = `${directory}/${name}`
      if (!referenced.has(key)) await rm(filePath(key), { force: true })
    }
  }
}

export function createPhotoLock() {
  let tail = Promise.resolve()
  return async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await action()
    } finally {
      release()
    }
  }
}

export function attachPhotos(app: Hono, db: Pool) {
  const locked = createPhotoLock()
  let recovery: Promise<void> | null = null
  const ensureRecovered = () => {
    recovery ??= recoverPhotoFiles(db).catch((error) => {
      recovery = null
      throw error
    })
    return recovery
  }
  app.use('/api/photos/*', async (_c, next) => {
    await locked(async () => {
      await ensureRecovered()
      await next()
    })
  })
  app.use('/api/visits/:id/photos', async (_c, next) => {
    await locked(async () => {
      await ensureRecovered()
      await next()
    })
  })

  app.post('/api/visits/:id/photos', async (c) => {
    const id = parseUuid(c.req.param('id'))
    let form: FormData
    try {
      form = await c.req.raw.formData()
    } catch {
      throw new InputError({ files: 'multipart/form-dataを指定してください' })
    }
    const files = form.getAll('files')
    if (!files.length || files.length > 10 || files.some((file) => !(file instanceof File)))
      throw new InputError({ files: '画像を1〜10枚指定してください' })
    const input = files as File[]
    if (input.some((file) => file.size > maxBytes))
      throw new InputError({ files: '1枚15 MiB以内にしてください' })
    const processed = await Promise.all(
      input.map(async (file) => processImage(Buffer.from(await file.arrayBuffer()))),
    )
    const client = await db.connect()
    const created: string[] = []
    let committed = false
    try {
      await client.query('BEGIN')
      const visit = await client.query('SELECT 1 FROM visits WHERE id = $1 FOR UPDATE', [id])
      if (!visit.rowCount) {
        await client.query('ROLLBACK')
        return c.json({ error: { code: 'not_found', message: 'Visit not found' } }, 404)
      }
      const count = await client.query(
        'SELECT count(*)::int AS count FROM photos WHERE visit_id = $1',
        [id],
      )
      if (count.rows[0].count + input.length > 20)
        throw new InputError({ files: '1訪問20枚以内にしてください' })
      await mkdir(filePath('original'), { recursive: true })
      await mkdir(filePath('thumbnail'), { recursive: true })
      for (let index = 0; index < input.length; index++) {
        const photoId = randomUUID()
        const originalKey = `original/${photoId}`
        const thumbnailKey = `thumbnail/${photoId}.webp`
        created.push(originalKey)
        await writeFile(filePath(originalKey), processed[index].original, {
          flag: 'wx',
        })
        created.push(thumbnailKey)
        await writeFile(filePath(thumbnailKey), processed[index].thumbnail, {
          flag: 'wx',
        })
        await client.query(
          'INSERT INTO photos (id, visit_id, storage_key, thumbnail_key, original_filename, mime_type, byte_size, width, height, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            photoId,
            id,
            originalKey,
            thumbnailKey,
            input[index].name.slice(0, 255),
            processed[index].mimeType,
            processed[index].original.length,
            processed[index].width,
            processed[index].height,
            count.rows[0].count + index,
          ],
        )
      }
      const rows = await client.query(
        `SELECT ${photoColumns} FROM photos WHERE visit_id = $1 ORDER BY sort_order, id`,
        [id],
      )
      await client.query('COMMIT')
      committed = true
      return c.json(rows.rows.map(photoJson), 201)
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {})
        await Promise.all(created.map((key) => rm(filePath(key), { force: true })))
      }
      throw error
    } finally {
      client.release()
    }
  })

  app.get('/api/photos/:id/file', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const variant = c.req.query('variant') ?? 'thumbnail'
    if (variant !== 'thumbnail' && variant !== 'original')
      throw new InputError({
        variant: 'originalかthumbnailを指定してください',
      })
    const result = await db.query(
      'SELECT storage_key, thumbnail_key, mime_type FROM photos WHERE id = $1',
      [id],
    )
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Photo not found' } }, 404)
    const key = variant === 'original' ? result.rows[0].storage_key : result.rows[0].thumbnail_key
    try {
      const bytes = await readFile(filePath(key))
      c.header('Content-Type', variant === 'original' ? result.rows[0].mime_type : 'image/webp')
      c.header('Cache-Control', 'private, max-age=60')
      return c.body(new Uint8Array(bytes))
    } catch {
      return c.json(
        {
          error: {
            code: 'storage_unavailable',
            message: 'Photo file unavailable',
          },
        },
        503,
      )
    }
  })

  app.patch('/api/photos/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new InputError({ body: 'JSONオブジェクトを指定してください' })
    const order = (body as Record<string, unknown>).sortOrder
    const caption = (body as Record<string, unknown>).caption
    if (order === undefined && caption === undefined)
      throw new InputError({ body: '更新項目を指定してください' })
    if (order !== undefined && (!Number.isInteger(order) || (order as number) < 0))
      throw new InputError({ sortOrder: '0以上の整数を指定してください' })
    if (
      caption !== undefined &&
      caption !== null &&
      (typeof caption !== 'string' || caption.length > 1000)
    )
      throw new InputError({
        caption: '1000文字以内の文字列を指定してください',
      })
    const setters: string[] = []
    const values: unknown[] = []
    if (order !== undefined) {
      values.push(order)
      setters.push(`sort_order = $${values.length}`)
    }
    if (caption !== undefined) {
      values.push(caption === '' ? null : caption)
      setters.push(`caption = $${values.length}`)
    }
    values.push(id)
    const result = await db.query(
      `UPDATE photos SET ${setters.join(', ')} WHERE id = $${values.length} RETURNING ${photoColumns}`,
      values,
    )
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Photo not found' } }, 404)
    return c.json(photoJson(result.rows[0]))
  })

  app.delete('/api/photos/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const client = await db.connect()
    const moved: Array<[string, string]> = []
    let committed = false
    try {
      await client.query('BEGIN')
      const result = await client.query(
        'SELECT storage_key, thumbnail_key FROM photos WHERE id = $1 FOR UPDATE',
        [id],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        return c.json({ error: { code: 'not_found', message: 'Photo not found' } }, 404)
      }
      await mkdir(filePath('pending-delete'), { recursive: true })
      for (const key of [result.rows[0].storage_key, result.rows[0].thumbnail_key]) {
        if (!key) continue
        const staged = `pending-delete/${id}-${key.startsWith('original/') ? 'original' : 'thumbnail'}`
        await rename(filePath(key), filePath(staged))
        moved.push([key, staged])
      }
      await client.query('DELETE FROM photos WHERE id = $1', [id])
      await client.query('COMMIT')
      committed = true
      try {
        await Promise.all(moved.map(([, staged]) => rm(filePath(staged), { force: true })))
      } catch (error) {
        recovery = null
        throw error
      }
      return c.body(null, 204)
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {})
        await Promise.all(moved.map(([key, staged]) => rename(filePath(staged), filePath(key))))
      }
      throw error
    } finally {
      client.release()
    }
  })
}
