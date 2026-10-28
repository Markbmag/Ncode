/**
 * Browser tests (roadmap M10): `npm run e2e`.
 *
 * Starts a throw-away backend with test data (backend/tests/e2e_server.py) and the Vite dev
 * server pointing at it, then drives Chromium. Locally an installed Chromium can be used with
 * NCODE_E2E_CHROMIUM=/path/to/chrome; CI installs Playwright's own (`npx playwright install chromium`).
 */
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const API_PORT = 8765;
const WEB_PORT = 4173;
const python = process.env.NCODE_E2E_PYTHON || (existsSync('../backend/.venv/bin/python') ? '.venv/bin/python' : 'python');
const executablePath = process.env.NCODE_E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // one shared backend: tests create their own content but share users
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: [
    {
      command: `${python} -m tests.e2e_server --port ${API_PORT} --origin http://127.0.0.1:${WEB_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
