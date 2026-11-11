import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  max: Number(process.env.PGPOOL_MAX || 3),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.code || error.message)
})
