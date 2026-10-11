import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { applyMigration } from './migrate.js'

const schema = `test_${randomUUID().replaceAll('-', '')}`
const client = new Client({
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})
const sql = await readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8')

beforeAll(async () => {
  await client.connect()
  await client.query(`CREATE SCHEMA "${schema}"`)
  await client.query(`SET search_path TO "${schema}", public`)
})

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await client.end()
})

describe('initial schema migration', () => {
  it('creates three tables once and preserves data on repeat', async () => {
    await applyMigration(client, sql, '001_initial')
    const place = await client.query<{ id: string }>(
      "INSERT INTO places (name, latitude, longitude) VALUES ('架空の公園', 35.5, 139.5) RETURNING id",
    )
    const visit = await client.query<{ id: string }>(
      'INSERT INTO visits (place_id, visited_at) VALUES ($1, $2) RETURNING id',
      [place.rows[0].id, '2026-10-01T09:00:00+09:00'],
    )
    await client.query(
      "INSERT INTO photos (visit_id, storage_key, original_filename, mime_type, byte_size, sort_order) VALUES ($1, 'original/a.jpg', 'a.jpg', 'image/jpeg', 100, 0)",
      [visit.rows[0].id],
    )

    await applyMigration(client, sql, '001_initial')
    expect((await client.query('SELECT count(*)::int AS count FROM places')).rows[0].count).toBe(1)
    expect((await client.query('SELECT count(*)::int AS count FROM visits')).rows[0].count).toBe(1)
    expect((await client.query('SELECT count(*)::int AS count FROM photos')).rows[0].count).toBe(1)
  })

  it('rejects blank place names and out-of-range coordinates', async () => {
    await expect(
      client.query("INSERT INTO places (name, latitude, longitude) VALUES ('   ', 0, 0)"),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query("INSERT INTO places (name, latitude, longitude) VALUES ('A', 90.000001, 0)"),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      client.query("INSERT INTO places (name, latitude, longitude) VALUES ('A', 0, -180.000001)"),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects unknown references and protects visits from place deletion', async () => {
    await expect(
      client.query('INSERT INTO visits (place_id, visited_at) VALUES ($1, now())', [randomUUID()]),
    ).rejects.toMatchObject({ code: '23503' })
    const place = await client.query<{ id: string }>(
      "INSERT INTO places (name, latitude, longitude) VALUES ('架空の駅', 0, 0) RETURNING id",
    )
    await client.query('INSERT INTO visits (place_id, visited_at) VALUES ($1, now())', [
      place.rows[0].id,
    ])
    await expect(
      client.query('DELETE FROM places WHERE id = $1', [place.rows[0].id]),
    ).rejects.toMatchObject({ code: '23503' })
  })
})
