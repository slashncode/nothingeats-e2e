import type { ReporterDescription } from '@playwright/test';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { baseUrl } from './tests/support/env.ts';

const ci = process.env.CI === 'true';
// `--project chaos` or `--project=chaos`.
const project = process.argv.some(arg => arg === 'chaos' || arg === '--project=chaos')
    ? 'chaos'
    : 'shop';
const reporters: ReporterDescription[] = [
    ['list'],
    // One report per project: the workflow runs shop and chaos one after the other, and the second
    // run would otherwise replace the first one's report (and the traces and videos of a failure).
    [
        'html',
        { open: 'never', outputFolder: `playwright-report/${project}` },
    ],
];

export default defineConfig({
    globalSetup: './tests/global-setup.ts',
    // A whole order with delivery runs in one test; locally a delivery takes three minutes.
    timeout: 5 * 60_000,
    expect: { timeout: 15_000 },
    // Tests share one customer per worker (identity allows 10 registrations an hour per address).
    workers: 2,
    forbidOnly: ci,
    // No retries: a flaky system test is a finding, not noise.
    retries: 0,
    reporter: ci
        ? [
                ['github'],
                ...reporters,
            ]
        : reporters,
    use: {
        baseURL: baseUrl,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    projects: [
        // What a customer does, against any cluster: `pnpm test`.
        { name: 'shop', testDir: 'tests/shop', outputDir: 'test-results/shop' },
        // Pods crash in the middle of an order, on a disposable cluster only: `pnpm chaos`.
        { name: 'chaos', testDir: 'tests/chaos', outputDir: 'test-results/chaos' },
    ],
});
