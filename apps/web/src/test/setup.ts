import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetMockRegistry } from '@/test/mock-fetch'
import { resetPrivyMock } from '@/test/privy-mock'

/**
 * Global jsdom setup for the `web` vitest project (PR2b W0). Runs before every
 * SPA test file:
 *
 *   - registers `@testing-library/jest-dom` matchers (`toBeInTheDocument`, …),
 *   - tears down the rendered React tree after each test (`cleanup`),
 *   - resets the shared mock-fetch registry + the Privy mock between tests so
 *     state never leaks across cases (the Phase-2 test writers rely on this).
 */
afterEach(() => {
  cleanup()
  resetMockRegistry()
  resetPrivyMock()
})
