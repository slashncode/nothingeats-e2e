import type { Account } from './accounts.ts';
import { test as base } from '@playwright/test';
import { registerVerified } from './accounts.ts';
import { baseUrl } from './env.ts';

/**
 * - `page` declines the analytics banner whenever it shows up (only on clusters with a PostHog key).
 * - `customer`: one verified account per worker, for tests that need someone signed in.
 */
export const test = base.extend<object, { customer: Account }>({
    page: async ({ page }, use) => {
        await page.addLocatorHandler(page.getByRole('button', { name: 'Lieber nicht' }), button => button.click());
        await use(page);
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

export { expect } from '@playwright/test';
