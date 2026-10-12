import { describe, expect, it } from 'vitest'
import { parsePlace, parseVisit, parsePage, parseUuid } from './validation.js'

describe('API input validation', () => {
  it('accepts coordinate boundaries and trims optional strings', () => {
    expect(
      parsePlace({
        name: '  公園  ',
        latitude: -90,
        longitude: 180,
        category: ' ',
      }),
    ).toEqual({
      name: '公園',
      latitude: -90,
      longitude: 180,
      category: null,
    })
  })

  it('rejects blank names, excessive coordinate precision and invalid coordinates', () => {
    expect(() => parsePlace({ name: ' ', latitude: 0, longitude: 0 })).toThrow()
    expect(() => parsePlace({ name: 'A', latitude: 90.000001, longitude: 0 })).toThrow()
    expect(() => parsePlace({ name: 'A', latitude: 1.0000001, longitude: 0 })).toThrow()
  })

  it('requires an offset for visits and preserves the instant', () => {
    const placeId = 'b3c68aae-9718-4d29-a7d9-2ea114f36d2a'
    expect(parseVisit({ placeId, visitedAt: '2026-10-01T09:00:00+09:00' }).visitedAt).toBe(
      '2026-10-01T00:00:00.000Z',
    )
    expect(() => parseVisit({ placeId, visitedAt: '2026-10-01T09:00:00' })).toThrow()
    expect(() => parseVisit({ placeId, visitedAt: '2026-02-30T09:00:00Z' })).toThrow()
  })

  it('rejects malformed IDs and list cursors', () => {
    expect(() => parseUuid('abc')).toThrow()
    expect(() => parsePage(new URLSearchParams('limit=51'))).toThrow()
    expect(() => parsePage(new URLSearchParams('cursor=bad'))).toThrow()
  })
})
