import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { applyMigration } from './migrate.js'

const client = new Client({
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})

try {
  await client.connect()
  const sql = await readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8')
  await applyMigration(client, sql, '001_initial')
  console.log('Migration 001_initial applied or already present')
} finally {
  await client.end()
}
