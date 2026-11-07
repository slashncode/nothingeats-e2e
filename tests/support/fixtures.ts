import type { Account } from './accounts.ts';
import { test as base, expect } from '@playwright/test';
import { registerVerified } from './accounts.ts';
import { baseUrl } from './env.ts';

/**
 * - `page` declines the analytics banner whenever it shows up (only on clusters with a PostHog key),
 *   and fails the test when the page breaks its Content-Security-Policy: whatever the policy blocks,
 *   a customer would miss.
 * - `customer`: one verified account per worker, for tests that need someone signed in.
 */
export const test = base.extend<object, { customer: Account }>({
    page: async ({ page }, use) => {
        const violations: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error' && message.text().includes('Content Security Policy'))
                violations.push(message.text());
        });
        await page.addLocatorHandler(page.getByRole('button', { name: 'Lieber nicht' }), button => button.click());
        await use(page);
        expect(violations, 'Content-Security-Policy violations').toEqual([]);
    },
    customer: [
        async ({ playwright }, use) => {
            const request = await playwright.request.newContext({ baseURL: baseUrl });
            await use(await registerVerified(request));
            await request.dispose();
        },
        { scope: 'worker' },
    ],
});

export { expect };
