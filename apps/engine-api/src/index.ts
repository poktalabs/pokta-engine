import { serve } from '@hono/node-server'
import { getBoss } from '@pokta-engine/queue'
import { buildApp } from './app'

// Entrypoint ONLY. buildApp() has no import-time side effects; the queue + HTTP
// server are started here so importing './app' in tests touches nothing.
const app = buildApp()
const port = Number(process.env.PORT ?? 8787)

await getBoss() // ensure the queue exists before serving
serve({ fetch: app.fetch, port })
console.log(`[engine-api] listening on :${port}`)
