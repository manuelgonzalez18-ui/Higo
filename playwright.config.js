import { defineConfig } from '@playwright/test';
import { TEST_ENVIRONMENT } from './src/config/testEnvironment.js';
export default defineConfig({
    testDir: './e2e', fullyParallel: true, retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 844 },
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
        serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
        env: TEST_ENVIRONMENT,
        url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
