import { expect, test } from '../support/fixtures.ts';

// catalog -> search: the seed reached Elasticsearch, German compounds and facets work.
test('a word start suggests the dish', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Gerichte und Restaurants suchen' }).first().fill('pomm');
    await page.getByRole('option', { name: /Trüffelpommes/ }).click();
    await expect(page).toHaveURL(/\/search\?q=Tr%C3%BCffelpommes/);
    await expect(page.getByRole('heading', { level: 3, name: /Trüffelpommes/ })).toBeVisible();
});

test('facets narrow the results', async ({ page }) => {
    await page.goto('/search?q=Pizza');
    const total = page.getByRole('heading', { level: 2, name: /Gericht/ });
    const count = async () => Number.parseInt(await total.textContent() ?? '');
    await expect(total).toHaveText(/^\d+ Gerichte$/);
    const all = await count();

    await page.getByRole('grid', { name: 'Ernährung' }).getByRole('row', { name: /^Vegan/ }).click();
    await expect(page).toHaveURL(/diet=vegan/);
    await expect.poll(count).toBeLessThan(all);
    expect(await count()).toBeGreaterThan(0);
});
