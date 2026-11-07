import type { ReporterDescription } from '@playwright/test';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { baseUrl } from './tests/support/env.ts';

const ci = process.env.CI === 'true';
const reporters: ReporterDescription[] = [
    ['list'],
    [
        'html',
        { open: 'never' },
    ],
];

export default defineConfig({
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
        { name: 'shop', testDir: 'tests/shop' },
        // Pods crash in the middle of an order, on a disposable cluster only: `pnpm chaos`.
        { name: 'chaos', testDir: 'tests/chaos' },
    ],
});
