import { newAccount, signIn } from './support/accounts.ts';
import { expect, test } from './support/fixtures.ts';
import { linkTo, waitForMail } from './support/mailpit.ts';
import { restaurantToOrderFrom } from './support/shop.ts';

// The whole way through the shop, as a new customer: every service takes part.
// identity -> notification (mails) -> catalog/ordering -> delivery (gRPC quote, simulation)
// -> notification (live stream, mails) -> loyalty (rewards on the live stream).
test('a new customer orders nothing and watches it arrive', async ({ page, request }) => {
    const { restaurant, sections } = await restaurantToOrderFrom(request);
    const dish = sections.flatMap(section => section.dishes).toSorted((a, b) => b.priceCents - a.priceCents)[0]!;
    const quantity = Math.ceil(restaurant.minimumOrderCents / dish.priceCents);
    const account = newAccount();

    await test.step('register', async () => {
        await page.goto('/register');
        await page.getByRole('textbox', { name: 'E-Mail' }).fill(account.email);
        await page.getByLabel('Passwort').fill(account.password);
        await page.getByRole('button', { name: 'Registrieren', exact: true }).click();
        await expect(page.getByRole('status')).toContainText('Wir haben dir eine E-Mail geschickt');
    });

    await test.step('confirm the address from the mail', async () => {
        const mail = await waitForMail(account.email, /bestätige deine E-Mail-Adresse/);
        await page.goto(linkTo(mail, '/verify'));
        await expect(page.getByText('Deine E-Mail-Adresse ist bestätigt.')).toBeVisible();
        await waitForMail(account.email, /^Willkommen bei NothingEats$/);
    });

    await test.step('sign in', () => signIn(page, account));

    await test.step(`put ${quantity} × ${dish.name} in the cart`, async () => {
        await page.goto(`/restaurants/${restaurant.slug}`);
        const add = page.getByRole('button', { name: `${dish.name} in den Warenkorb` });
        for (let added = 1; added <= quantity; added++) {
            await add.click();
            await expect(page.getByRole('link', {
                name: new RegExp(`Warenkorb, ${added} Gericht`),
            })).toBeVisible();
        }
    });

    await test.step('pay with willpower', async () => {
        await page.getByRole('link', { name: /Warenkorb, \d+ Gericht/ }).click();
        await expect(page.getByText(/Ankunft in etwa \d+ Minute/)).toBeVisible();
        await page.getByRole('button', { name: 'Mit Willenskraft bezahlen' }).click();
        await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
        await expect(page.getByRole('heading', { name: `Deine Bestellung bei ${restaurant.name}` })).toBeVisible();
    });

    await test.step('nothing arrives, live', async () => {
        // A 30-minute delivery takes 36 seconds at the CI cluster's time scale and 3 minutes locally.
        await expect(page.getByText('Nichts ist angekommen. Guten Appetit!')).toBeVisible({ timeout: 240_000 });
        await expect(page.getByText(/XP für dein Nichts/)).toBeVisible({ timeout: 30_000 });
    });

    await test.step('the mails', async () => {
        await waitForMail(account.email, new RegExp(`^Bestellt bei ${restaurant.name}`));
        await waitForMail(account.email, /^Dein Nichts ist da$/);
    });

    await test.step('the first badge', async () => {
        await page.goto('/account/rewards');
        await expect(page.getByRole('heading', { name: /^Abzeichen \([1-9]\d* von \d+\)$/ })).toBeVisible();
    });
});
