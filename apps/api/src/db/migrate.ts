import type { Client } from 'pg'

export async function applyMigration(client: Client, sql: string, version: string): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
      version,
    ])
    if (existing.rowCount === 0) {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
