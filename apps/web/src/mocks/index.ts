/**
 * Mock entrypoint. Importing this module registers every per-surface fixture
 * with the registry. P0 ships the seam only; P2–P4 add fixture imports here
 * (e.g. `import './approvals'`). Keeping a single barrel means the api layer
 * (and tests) enable mocks with one import.
 */
export { registerMock, resetMocks, resolveMock } from './registry'
export type { MockContext, MockHandler, MockMethod } from './registry'

// Per-surface fixtures register their handlers by side-effect on import. PR2b W6
// wires every surface that goes through `apiFetch` → `resolveMock` so each
// reachable page resolves under mock mode (`VITE_USE_MOCKS`). `approvals`,
// `integrations`, and `reports` call `registerMock` at import time; `runs`,
// `workflows`, and `settings` are consumed directly by their pages (no route to
// register) but are imported here too so the barrel is the single mock entry.
import './approvals'
import './integrations'
import './reports'
import './runs'
import './workflows'
import './settings'
