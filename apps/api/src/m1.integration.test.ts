import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import sharp from 'sharp'
import { applyMigration } from './db/migrate.js'

const schema = `m1_test_${randomUUID().replaceAll('-', '')}`
const connection = {
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
}
const admin = new Client(connection)
let pool: Pool
let app: Awaited<ReturnType<typeof makeApp>>
let storageRoot: string
let adminConnected = false

async function makeApp() {
  const { createApp } = await import('./app.js')
  return createApp(async () => {}, pool)
}

const body = (method: string, data: object) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
const image = await sharp({
  create: { width: 12, height: 12, channels: 3, background: '#147852' },
})
  .png()
  .toBuffer()

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'place-chronicle-m1-'))
  process.env.UPLOAD_DIR = storageRoot
  await admin.connect()
  adminConnected = true
  await admin.query(`CREATE SCHEMA "${schema}"`)
  await admin.query(`SET search_path TO "${schema}", public`)
  const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8')
  await applyMigration(admin, sql, '001_initial')
  pool = new Pool({
    ...connection,
    options: `-c search_path=${schema},public`,
  })
  app = await makeApp()
})

afterAll(async () => {
  if (pool) await pool.end()
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
    await admin.end().catch(() => {})
  }
  if (storageRoot && resolve(storageRoot).startsWith(resolve(tmpdir()) + sep))
    await rm(storageRoot, { recursive: true, force: true })
  delete process.env.UPLOAD_DIR
})

describe('M1 real database flow', () => {
  it('creates repeat visits, paginates, uploads an original and thumbnail, then deletes in order', async () => {
    const placeResponse = await app.request(
      '/api/places',
      body('POST', { name: '架空の公園', latitude: 35.5, longitude: 139.5 }),
    )
    expect(placeResponse.status).toBe(201)
    const place = await placeResponse.json()
    const updatedPlace = await app.request(
      `/api/places/${place.id}`,
      body('PATCH', { category: '公園' }),
    )
    expect(updatedPlace.status).toBe(200)
    expect((await updatedPlace.json()).category).toBe('公園')
    expect((await (await app.request('/api/places?limit=1')).json()).items[0].id).toBe(place.id)
    expect((await (await app.request('/api/places?q=%25')).json()).items).toEqual([])
    const first = await (
      await app.request(
        '/api/visits',
        body('POST', {
          placeId: place.id,
          visitedAt: '2026-10-01T09:00:00+09:00',
          text: '初回',
        }),
      )
    ).json()
    const second = await (
      await app.request(
        '/api/visits',
        body('POST', {
          placeId: place.id,
          visitedAt: '2026-10-02T09:00:00+09:00',
          text: '再訪',
        }),
      )
    ).json()
    const updatedVisit = await app.request(
      `/api/visits/${second.id}`,
      body('PATCH', { text: '再訪した' }),
    )
    expect(updatedVisit.status).toBe(200)
    expect((await updatedVisit.json()).text).toBe('再訪した')
    const page1 = await (await app.request(`/api/visits?placeId=${place.id}&limit=1`)).json()
    expect(page1.items.map((visit: { id: string }) => visit.id)).toEqual([second.id])
    const page2 = await (
      await app.request(
        `/api/visits?placeId=${place.id}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`,
      )
    ).json()
    expect(page2.items.map((visit: { id: string }) => visit.id)).toEqual([first.id])
    expect((await app.request(`/api/places/${place.id}`, { method: 'DELETE' })).status).toBe(409)

    const form = new FormData()
    form.append('files', new File([new Uint8Array(image)], 'test.png', { type: 'image/png' }))
    const photoResponse = await app.request(`/api/visits/${first.id}/photos`, {
      method: 'POST',
      body: form,
    })
    expect(photoResponse.status).toBe(201)
    const photos = await photoResponse.json()
    expect(photos).toHaveLength(1)
    const reordered = await app.request(
      `/api/photos/${photos[0].id}`,
      body('PATCH', { sortOrder: 3 }),
    )
    expect((await reordered.json()).sortOrder).toBe(3)
    const original = await app.request(photos[0].originalUrl)
    expect(Buffer.from(await original.arrayBuffer())).toEqual(image)
    const thumbnail = await app.request(photos[0].thumbnailUrl)
    expect(thumbnail.headers.get('content-type')).toContain('image/webp')
    expect((await app.request(`/api/visits/${first.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await app.request(`/api/photos/${photos[0].id}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await app.request(`/api/visits/${first.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/visits/${second.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/places/${place.id}`, { method: 'DELETE' })).status).toBe(204)
  })

  it('removes saved files and rolls back photo rows when the database write fails', async () => {
    const place = await (
      await app.request(
        '/api/places',
        body('POST', { name: '架空の駅', latitude: 0, longitude: 0 }),
      )
    ).json()
    const visit = await (
      await app.request(
        '/api/visits',
        body('POST', { placeId: place.id, visitedAt: '2026-10-01T09:00:00Z' }),
      )
    ).json()
    await admin.query(
      "CREATE FUNCTION fail_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'insert failed'; END $$",
    )
    await admin.query(
      'CREATE TRIGGER fail_photo_insert BEFORE INSERT ON photos FOR EACH ROW EXECUTE FUNCTION fail_photo()',
    )
    const before = await readdir(join(storageRoot, 'original')).catch(() => [])
    const form = new FormData()
    form.append('files', new File([new Uint8Array(image)], 'failure.png', { type: 'image/png' }))
    expect(
      (
        await app.request(`/api/visits/${visit.id}/photos`, {
          method: 'POST',
          body: form,
        })
      ).status,
    ).toBe(503)
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM photos WHERE visit_id = $1', [
          visit.id,
        ])
      ).rows[0].count,
    ).toBe(0)
    expect(await readdir(join(storageRoot, 'original'))).toEqual(before)
    await admin.query('DROP TRIGGER fail_photo_insert ON photos')
    await admin.query('DROP FUNCTION fail_photo()')
  })

  it('rejects invalid image data, too many files and a visit over its photo limit', async () => {
    const place = await (
      await app.request(
        '/api/places',
        body('POST', { name: '架空の港', latitude: -90, longitude: 180 }),
      )
    ).json()
    const visit = await (
      await app.request(
        '/api/visits',
        body('POST', { placeId: place.id, visitedAt: '2026-10-01T09:00:00Z' }),
      )
    ).json()
    const invalid = new FormData()
    invalid.append('files', new File(['text'], 'fake.png', { type: 'image/png' }))
    expect(
      (
        await app.request(`/api/visits/${visit.id}/photos`, {
          method: 'POST',
          body: invalid,
        })
      ).status,
    ).toBe(400)
    const oversized = new FormData()
    for (let index = 0; index < 11; index++)
      oversized.append('files', new File([new Uint8Array(image)], `${index}.png`))
    expect(
      (
        await app.request(`/api/visits/${visit.id}/photos`, {
          method: 'POST',
          body: oversized,
        })
      ).status,
    ).toBe(400)
    for (let index = 0; index < 20; index++) {
      await pool.query(
        'INSERT INTO photos (visit_id, storage_key, original_filename, mime_type, byte_size, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [visit.id, `test-${randomUUID()}`, 'seed.png', 'image/png', 1, index],
      )
    }
    const one = new FormData()
    one.append('files', new File([new Uint8Array(image)], 'one.png'))
    expect(
      (
        await app.request(`/api/visits/${visit.id}/photos`, {
          method: 'POST',
          body: one,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM photos WHERE visit_id = $1', [
          visit.id,
        ])
      ).rows[0].count,
    ).toBe(20)
  })

  it('stores ten visits and thirty photos with fictional data', async () => {
    const place = await (
      await app.request(
        '/api/places',
        body('POST', { name: '架空の広場', latitude: 35, longitude: 139 }),
      )
    ).json()
    for (let day = 1; day <= 10; day++) {
      const visit = await (
        await app.request(
          '/api/visits',
          body('POST', {
            placeId: place.id,
            visitedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00+09:00`,
          }),
        )
      ).json()
      const form = new FormData()
      for (let index = 0; index < 3; index++)
        form.append('files', new File([new Uint8Array(image)], `${day}-${index}.png`))
      expect(
        (
          await app.request(`/api/visits/${visit.id}/photos`, {
            method: 'POST',
            body: form,
          })
        ).status,
      ).toBe(201)
    }
    const result = await pool.query(
      'SELECT count(DISTINCT v.id)::int AS visits, count(p.id)::int AS photos FROM visits v JOIN photos p ON p.visit_id = v.id WHERE v.place_id = $1',
      [place.id],
    )
    expect(result.rows[0]).toEqual({ visits: 10, photos: 30 })
  })

  it('recovers staged deletion and removes orphan uploads after a crash', async () => {
    const { recoverPhotoFiles } = await import('./photos.js')
    const place = await (
      await app.request(
        '/api/places',
        body('POST', { name: '架空の森', latitude: 1, longitude: 1 }),
      )
    ).json()
    const visit = await (
      await app.request(
        '/api/visits',
        body('POST', { placeId: place.id, visitedAt: '2026-10-01T00:00:00Z' }),
      )
    ).json()
    const photoId = randomUUID()
    const originalKey = `original/${photoId}`
    await pool.query(
      'INSERT INTO photos (id, visit_id, storage_key, original_filename, mime_type, byte_size, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [photoId, visit.id, originalKey, 'kept.png', 'image/png', image.length, 0],
    )
    await mkdir(join(storageRoot, 'pending-delete'), { recursive: true })
    await writeFile(join(storageRoot, originalKey), image)
    await rename(
      join(storageRoot, originalKey),
      join(storageRoot, 'pending-delete', `${photoId}-original`),
    )
    const orphan = join(storageRoot, 'original', randomUUID())
    await writeFile(orphan, image)
    await recoverPhotoFiles(pool)
    expect(await readFile(join(storageRoot, originalKey))).toEqual(image)
    await expect(access(orphan)).rejects.toThrow()
  })
})
