import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required (see .env.example)')
}

/** Raw postgres-js client (also used for pg-boss elsewhere). */
export const sql = postgres(url, { max: 10 })

export const db = drizzle(sql, { schema })

export { schema }
export type DB = typeof db
