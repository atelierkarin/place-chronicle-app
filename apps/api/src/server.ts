import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { checkDatabase } from './db/connection.js'

const server = serve({
  fetch: createApp(checkDatabase).fetch,
  hostname: '127.0.0.1',
  port: 3000,
})

process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
