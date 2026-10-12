import { Hono } from 'hono'
import type { Pool } from 'pg'
import { attachRecords } from './records.js'
import { attachPhotos } from './photos.js'
import { InputError } from './validation.js'

export function createApp(checkDatabase: () => Promise<void>, db?: Pool) {
  const app = new Hono()

  app.onError((error, context) => {
    if (error instanceof InputError)
      return context.json(
        {
          error: {
            code: 'validation_error',
            message: error.message,
            fields: error.fields,
          },
        },
        400,
      )
    if ('code' in error && error.code === '23503')
      return context.json(
        {
          error: {
            code: 'conflict',
            message: 'Related records prevent this operation',
          },
        },
        409,
      )
    console.error('API error:', error)
    return context.json(
      {
        error: { code: 'database_unavailable', message: 'Service unavailable' },
      },
      503,
    )
  })

  app.notFound((context) =>
    context.json({ error: { code: 'not_found', message: 'Resource not found' } }, 404),
  )

  app.get('/api/health', async (context) => {
    try {
      await checkDatabase()
      return context.json({ status: 'ok', database: 'ok' })
    } catch {
      return context.json(
        {
          error: {
            code: 'database_unavailable',
            message: 'Database unavailable',
          },
        },
        503,
      )
    }
  })

  if (db) {
    attachRecords(app, db)
    attachPhotos(app, db)
  }

  return app
}
