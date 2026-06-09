/**
 * Shared SPA test harness barrel (PR2b W0). Phase-2 test writers import from
 * `@/test` for the renderer, the Privy mock, and the path-aware fetch helper —
 * one import surface so the harness stays consistent across test files.
 */
export {
  renderWithProviders,
  createTestQueryClient,
  type RenderWithProvidersOptions,
  type RenderWithProvidersResult,
} from './render'
export {
  privyMockFactory,
  privyMockState,
  privyMockSpies,
  setPrivyState,
  resetPrivyMock,
  usePrivyMock,
  PrivyProviderMock,
  type PrivyMockState,
  type UsePrivyMock,
} from './privy-mock'
export {
  installMockFetch,
  mockLivePath,
  resetMockRegistry,
  capturedRequests,
  type CapturedRequest,
  type HttpMethod,
  type MockResponseSpec,
  type MockResponder,
} from './mock-fetch'
