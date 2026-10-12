import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createApp } from './app.js'

const placeId = 'b3c68aae-9718-4d29-a7d9-2ea114f36d2a'
const visitId = '4c82d727-b72e-4bf1-bc16-f60566cc18df'

function appWithQuery(query: ReturnType<typeof vi.fn>) {
  return createApp(async () => {}, { query } as unknown as Pool)
}

describe('record API boundary', () => {
  it('rejects an invalid place before querying the database', async () => {
    const query = vi.fn()
    const response = await appWithQuery(query).request(
      '/api/places',
      json('POST', { name: ' ', latitude: 0, longitude: 0 }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields.name).toBeDefined()
    expect(query).not.toHaveBeenCalled()
  })

  it('normalizes a visit timestamp and returns a created visit', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: visitId,
            place_id: placeId,
            visited_at: new Date('2026-10-01T00:00:00Z'),
            text: '',
            created_at: new Date('2026-10-11T00:00:00Z'),
            updated_at: new Date('2026-10-11T00:00:00Z'),
          },
        ],
      })
    const response = await appWithQuery(query).request(
      '/api/visits',
      json('POST', { placeId, visitedAt: '2026-10-01T09:00:00+09:00' }),
    )
    expect(response.status).toBe(201)
    expect((await response.json()).visitedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(query.mock.calls[1][1]).toEqual([placeId, '2026-10-01T00:00:00.000Z', ''])
  })

  it('reports a missing parent place as 404', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] })
    const response = await appWithQuery(query).request(
      '/api/visits',
      json('POST', { placeId, visitedAt: '2026-10-01T09:00:00+09:00' }),
    )
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('not_found')
  })

  it('reports the child count when place deletion is blocked', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ count: 2 }] })
    const response = await appWithQuery(query).request(`/api/places/${placeId}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(409)
    expect((await response.json()).error.count).toBe(2)
  })
})

function json(method: string, body: object) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
