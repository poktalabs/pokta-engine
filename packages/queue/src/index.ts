import PgBoss from 'pg-boss'

/** Single job queue (transport only; governance lives in the control plane). */
export const QUEUE = 'workflow.run'

export interface RunJob {
  runId: string
}

let bossPromise: Promise<PgBoss> | null = null

/**
 * Lazily start a shared pg-boss bound to DATABASE_URL and ensure the queue
 * exists (pg-boss v10 requires explicit createQueue). Idempotent per process.
 */
export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required (see .env.example)')
    const boss = new PgBoss(url)
    bossPromise = boss.start().then(async () => {
      await boss.createQueue(QUEUE)
      return boss
    })
  }
  return bossPromise
}

export { PgBoss }
