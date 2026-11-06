import { signIn } from './support/accounts.ts';
import { expect, test } from './support/fixtures.ts';

// web -> assistant -> search (gRPC Retrieve) -> catalog-checked cards. On the CI cluster the coach
// runs its scripted model: it searches for what was written and shows the first three dishes.
test('the craving coach answers with dishes', async ({ page, customer }) => {
    await signIn(page, customer);
    await page.getByRole('button', { name: 'Craving Coach' }).click();
    await page.getByRole('textbox', { name: 'Deine Nachricht an den Craving Coach' }).fill('Pizza');
    await page.getByRole('button', { name: 'Senden' }).click();

    const log = page.getByRole('log', { name: 'Gespräch mit dem Craving Coach' });
    await expect(log.getByText(/Gesucht: „.+“/)).toBeVisible({ timeout: 60_000 });
    const cards = log.getByRole('region', { name: 'Vorschläge des Craving Coach' }).getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(cards).not.toHaveCount(0);
});
