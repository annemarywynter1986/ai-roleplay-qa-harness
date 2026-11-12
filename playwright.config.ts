import { defineConfig, devices } from '@playwright/test';

const PORT = 4317;

export default defineConfig({
  testDir: './tests',
  // The mock keeps state in memory, so API and UI tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node src/server.ts',
    url: `http://localhost:${PORT}/health`,
    // Always start fresh so MOCK_FAULTS reaches the server.
    reuseExistingServer: false,
    stdout: 'ignore',
  },
  projects: [
    { name: 'logic', testMatch: /(unit|ai-eval)\/.*\.spec\.ts/ },
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    { name: 'ui', testMatch: /ui\/.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
});
