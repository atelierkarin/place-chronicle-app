import { describe, expect, it } from 'vitest'
import { places, visits, visitsForPlace } from './demo-data'

describe('M0 demo records', () => {
  it('uses ten fictional visits with valid place references', () => {
    expect(visits).toHaveLength(10)
    const placeIds = new Set(places.map((place) => place.id))
    expect(visits.every((visit) => placeIds.has(visit.placeId))).toBe(true)
  })

  it('shows repeat visits together, newest first', () => {
    const repeatVisits = visitsForPlace('garden-cafe')
    expect(repeatVisits).toHaveLength(3)
    expect(repeatVisits.map((visit) => visit.date)).toEqual([
      '2026-10-04',
      '2026-06-18',
      '2025-11-23',
    ])
    expect(visitsForPlace('unknown')).toEqual([])
  })
})
