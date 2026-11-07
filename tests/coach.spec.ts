import type { Restaurant } from './support/shop.ts';
import { signIn } from './support/accounts.ts';
import { disposableCluster } from './support/env.ts';
import { expect, test } from './support/fixtures.ts';

// web -> assistant -> search (gRPC Retrieve) -> catalog-checked cards. On the CI cluster the coach
// runs its scripted model: it searches for what was written and shows the first three dishes.
test('the craving coach answers with dishes', async ({ page, request, customer }) => {
    const { items } = await (await request.get('/api/catalog/v1/restaurants?limit=50')).json() as { items: Restaurant[] };
    await signIn(page, customer);
    await page.getByRole('button', { name: 'Craving Coach' }).click();
    await page.getByRole('textbox', { name: 'Deine Nachricht an den Craving Coach' }).fill('Pizza');
    await page.getByRole('button', { name: 'Senden' }).click();

    const log = page.getByRole('log', { name: 'Gespräch mit dem Craving Coach' });
    await expect(log.getByText(/Gesucht: „.+“/)).toBeVisible({ timeout: 60_000 });
    // The turn is over when the typing indicator is gone; it ended well when no error shows.
    await expect(log.getByRole('status')).toHaveCount(0, { timeout: 60_000 });
    await expect(log.getByRole('alert')).toHaveCount(0);

    // A real model keeps to open restaurants, so at night it may rightly answer without dishes.
    if (!disposableCluster && !items.some(restaurant => restaurant.openNow))
        return;
    const cards = log.getByRole('list', { name: 'Vorschläge des Craving Coach' }).getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().getByRole('button', { name: /in den Warenkorb$/ })).toBeEnabled();
});
