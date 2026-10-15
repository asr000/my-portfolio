import { defineConfig } from '@playwright/test'
import process from 'node:process'
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179', channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://portfolio-test.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only-key',
    },
  },
})
