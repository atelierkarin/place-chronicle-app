import { Pool } from 'pg'

export const pool = new Pool({
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})

pool.on('error', (error) => {
  console.error('Idle database connection error:', error.message)
})

export async function checkDatabase(): Promise<void> {
  await pool.query('SELECT 1')
}
