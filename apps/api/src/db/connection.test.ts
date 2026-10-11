import { afterEach, describe, expect, it, vi } from 'vitest'
import { pool } from './connection.js'

afterEach(() => vi.restoreAllMocks())

describe('database pool', () => {
  it('does not crash the API when an idle connection fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => pool.emit('error', new Error('connection lost'))).not.toThrow()
  })
})
