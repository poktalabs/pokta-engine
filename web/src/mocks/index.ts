/**
 * Mock entrypoint. Importing this module registers every per-surface fixture
 * with the registry. P0 ships the seam only; P2–P4 add fixture imports here
 * (e.g. `import './approvals'`). Keeping a single barrel means the api layer
 * (and tests) enable mocks with one import.
 */
export { registerMock, resetMocks, resolveMock } from './registry'
export type { MockContext, MockHandler, MockMethod } from './registry'

// Per-surface fixtures are registered by importing them here in later phases:
// import './approvals'
// import './runs'
// import './workflows'
// import './integrations'
// import './reports'
