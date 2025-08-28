import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: 'lib/test/setup.js',
    coverage: {
      provider: 'v8'
    }
  },
})
