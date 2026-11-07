import { admin } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';

// The backoffice in a browser: an admin signs in with their NothingEats account and looks at the
// content and the operations views. It only reads, so it runs on any cluster; the page fixture
// fails it when /admin breaks its Content-Security-Policy.
test('an admin signs in and finds content and operations', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('E-Mail').fill(admin.email);
    await page.getByLabel('Passwort').fill(admin.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();

    const nav = page.getByRole('navigation');
    await nav.getByRole('link', { name: 'Restaurants' }).click();
    await page.getByRole('link', { name: 'Phantom Pizza' }).click();
    await expect(page.getByText('Speisekarte').first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Diavola Invisibile/ })).toBeVisible();

    await nav.getByRole('link', { name: 'Bestellungen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bestellungen' })).toBeVisible();

    await nav.getByRole('link', { name: 'Suchindex' }).click();
    await expect(page.getByText('Aktive Generation')).toBeVisible();
});
