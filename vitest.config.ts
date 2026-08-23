import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: 'lib/test/setup.js',
    // Many inherited tests probe and release an ephemeral port before binding
    // their real server. Running files concurrently lets another test steal
    // that port between those operations.
    fileParallelism: false,
    coverage: {
      provider: 'v8'
    },
    exclude: ['dist']
  },
})
