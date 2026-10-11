import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'

describe('GET /api/health', () => {
  it('returns ok when the database is available', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined)
    const response = await createApp(checkDatabase).request('/api/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' })
    expect(checkDatabase).toHaveBeenCalledOnce()
  })

  it('returns a service error when the database is unavailable', async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error('connection failed'))
    const response = await createApp(checkDatabase).request('/api/health')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'database_unavailable', message: 'Database unavailable' },
    })
  })
})
