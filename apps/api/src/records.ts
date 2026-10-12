import type { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  InputError,
  nextCursor,
  parsePage,
  parsePlace,
  parseUuid,
  parseVisit,
} from './validation.js'

type Row = Record<string, any>
const placeColumns =
  'id, name, category, latitude, longitude, address, note, created_at, updated_at'
const visitColumns = 'id, place_id, visited_at, text, created_at, updated_at'

export function placeJson(row: Row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function visitJson(row: Row) {
  return {
    id: row.id,
    placeId: row.place_id,
    visitedAt: row.visited_at.toISOString(),
    text: row.text ?? '',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function deleteConflict(count: number, kind: string) {
  return {
    error: {
      code: 'conflict',
      message: `先に関連する${kind}を削除してください`,
      count,
    },
  }
}

export function attachRecords(app: Hono, db: Pool) {
  app.post('/api/places', async (c) => {
    const body = parsePlace(await c.req.json().catch(() => null))
    const result = await db.query(
      `INSERT INTO places (name, category, latitude, longitude, address, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${placeColumns}`,
      [
        body.name,
        body.category ?? null,
        body.latitude,
        body.longitude,
        body.address ?? null,
        body.note ?? null,
      ],
    )
    return c.json(placeJson(result.rows[0]), 201)
  })

  app.get('/api/places', async (c) => {
    const { limit, cursor } = parsePage(new URL(c.req.url).searchParams)
    const q = c.req.query('q')?.trim().replace(/[!%_]/g, '!$&') ?? null
    const category = c.req.query('category')?.trim() ?? null
    const result = await db.query(
      `SELECT ${placeColumns} FROM places WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' ESCAPE '!') AND ($2::text IS NULL OR category = $2) AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid)) ORDER BY created_at DESC, id DESC LIMIT $5`,
      [q, category, cursor?.key ?? null, cursor?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    return c.json({
      items: rows.map(placeJson),
      nextCursor:
        result.rows.length > limit ? nextCursor(rows.at(-1)!.created_at, rows.at(-1)!.id) : null,
    })
  })

  app.get('/api/places/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const result = await db.query(
      `SELECT ${placeColumns}, (SELECT count(*)::int FROM visits WHERE place_id = places.id) AS visit_count FROM places WHERE id = $1`,
      [id],
    )
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Place not found' } }, 404)
    return c.json({
      ...placeJson(result.rows[0]),
      visitCount: result.rows[0].visit_count,
    })
  })

  app.patch('/api/places/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const body = parsePlace(await c.req.json().catch(() => null), true)
    const entries = Object.entries(body)
    const values = entries.map(([, value]) => value)
    const setters = entries.map(
      ([key], index) =>
        `${({ name: 'name', category: 'category', latitude: 'latitude', longitude: 'longitude', address: 'address', note: 'note' } as Record<string, string>)[key]} = $${index + 1}`,
    )
    const result = await db.query(
      `UPDATE places SET ${setters.join(', ')}, updated_at = now() WHERE id = $${values.length + 1} RETURNING ${placeColumns}`,
      [...values, id],
    )
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Place not found' } }, 404)
    return c.json(placeJson(result.rows[0]))
  })

  app.delete('/api/places/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const count = await db.query('SELECT count(*)::int AS count FROM visits WHERE place_id = $1', [
      id,
    ])
    if (count.rows[0].count) return c.json(deleteConflict(count.rows[0].count, '訪問記録'), 409)
    const result = await db.query('DELETE FROM places WHERE id = $1', [id])
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Place not found' } }, 404)
    return c.body(null, 204)
  })

  app.post('/api/visits', async (c) => {
    const body = parseVisit(await c.req.json().catch(() => null))
    const place = await db.query('SELECT 1 FROM places WHERE id = $1', [body.placeId])
    if (!place.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Place not found' } }, 404)
    const result = await db.query(
      `INSERT INTO visits (place_id, visited_at, text) VALUES ($1,$2,$3) RETURNING ${visitColumns}`,
      [body.placeId, body.visitedAt, body.text],
    )
    return c.json(visitJson(result.rows[0]), 201)
  })

  app.get('/api/visits', async (c) => {
    const { limit, cursor } = parsePage(new URL(c.req.url).searchParams)
    const placeId = c.req.query('placeId') ? parseUuid(c.req.query('placeId'), 'placeId') : null
    const category = c.req.query('category')?.trim() ?? null
    const yearMonth = c.req.query('yearMonth') ?? null
    const timeZone = c.req.query('timeZone') ?? null
    if (yearMonth && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) || !timeZone))
      throw new InputError({
        yearMonth: 'YYYY-MMとtimeZoneを指定してください',
      })
    if (timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format()
      } catch {
        throw new InputError({
          timeZone: '有効なIANAタイムゾーンを指定してください',
        })
      }
    }
    const start = yearMonth ? `${yearMonth}-01` : null
    const end = yearMonth
      ? new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5)), 1))
          .toISOString()
          .slice(0, 10)
      : null
    const result = await db.query(
      `SELECT ${visitColumns
        .split(', ')
        .map((column) => `v.${column}`)
        .join(
          ', ',
        )} FROM visits v JOIN places p ON p.id = v.place_id WHERE ($1::uuid IS NULL OR v.place_id = $1) AND ($2::text IS NULL OR p.category = $2) AND ($3::date IS NULL OR v.visited_at >= ($3::timestamp AT TIME ZONE $5)) AND ($4::date IS NULL OR v.visited_at < ($4::timestamp AT TIME ZONE $5)) AND ($6::timestamptz IS NULL OR (v.visited_at, v.id) < ($6, $7::uuid)) ORDER BY v.visited_at DESC, v.id DESC LIMIT $8`,
      [placeId, category, start, end, timeZone, cursor?.key ?? null, cursor?.id ?? null, limit + 1],
    )
    const rows = result.rows.slice(0, limit)
    return c.json({
      items: rows.map(visitJson),
      nextCursor:
        result.rows.length > limit ? nextCursor(rows.at(-1)!.visited_at, rows.at(-1)!.id) : null,
    })
  })

  app.get('/api/visits/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const result = await db.query(`SELECT ${visitColumns} FROM visits WHERE id = $1`, [id])
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Visit not found' } }, 404)
    const photos = await db.query(
      'SELECT id, visit_id, original_filename, mime_type, byte_size, width, height, caption, sort_order, created_at FROM photos WHERE visit_id = $1 ORDER BY sort_order, id',
      [id],
    )
    return c.json({
      ...visitJson(result.rows[0]),
      photos: photos.rows.map(photoJson),
    })
  })

  app.patch('/api/visits/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const body = parseVisit(await c.req.json().catch(() => null), true)
    const entries = Object.entries(body)
    const setters = entries.map(
      ([key], index) => `${key === 'visitedAt' ? 'visited_at' : 'text'} = $${index + 1}`,
    )
    const result = await db.query(
      `UPDATE visits SET ${setters.join(', ')}, updated_at = now() WHERE id = $${entries.length + 1} RETURNING ${visitColumns}`,
      [...entries.map(([, value]) => value), id],
    )
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Visit not found' } }, 404)
    return c.json(visitJson(result.rows[0]))
  })

  app.delete('/api/visits/:id', async (c) => {
    const id = parseUuid(c.req.param('id'))
    const count = await db.query('SELECT count(*)::int AS count FROM photos WHERE visit_id = $1', [
      id,
    ])
    if (count.rows[0].count) return c.json(deleteConflict(count.rows[0].count, '写真'), 409)
    const result = await db.query('DELETE FROM visits WHERE id = $1', [id])
    if (!result.rowCount)
      return c.json({ error: { code: 'not_found', message: 'Visit not found' } }, 404)
    return c.body(null, 204)
  })
}

export function photoJson(row: Row) {
  return {
    id: row.id,
    visitId: row.visit_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    caption: row.caption,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    thumbnailUrl: `/api/photos/${row.id}/file?variant=thumbnail`,
    originalUrl: `/api/photos/${row.id}/file?variant=original`,
  }
}
