import { Hono } from 'hono'

export function createApp(checkDatabase: () => Promise<void>) {
  const app = new Hono()

  app.notFound((context) =>
    context.json({ error: { code: 'not_found', message: 'Resource not found' } }, 404),
  )

  app.get('/api/health', async (context) => {
    try {
      await checkDatabase()
      return context.json({ status: 'ok', database: 'ok' })
    } catch {
      return context.json(
        { error: { code: 'database_unavailable', message: 'Database unavailable' } },
        503,
      )
    }
  })

  return app
}
