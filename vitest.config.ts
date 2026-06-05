import { defineConfig } from 'vitest/config'

// Phase 0 test harness (D6). Lanes add *.test.ts next to the code they cover:
//   packages/notion, packages/resend (unit), workflows/* (fail-soft), engine-api (shape).
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
})
