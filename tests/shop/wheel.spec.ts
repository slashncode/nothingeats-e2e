import { registerVerified, signIn } from '../support/accounts.ts';
import { CustomerApi } from '../support/api.ts';
import { disposableCluster } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';
import { cartFor, restaurantToOrderFrom, wheelAlwaysLandsOn } from '../support/shop.ts';

// Level up, spin, redeem: loyalty (XP, levels, the wheel from the backoffice) -> ordering, which
// prices and reserves the coupon over gRPC (the only path that uses loyalty's gRPC port).
test('a customer reaches level 2, wins a coupon on the wheel and pays less with it', async ({ page, request }) => {
    test.skip(!disposableCluster, 'Sets the wheel\'s odds in the backoffice: only on a disposable cluster.');
    test.setTimeout(8 * 60_000);

    await wheelAlwaysLandsOn(request, 'PERCENT_10');
    const menu = await restaurantToOrderFrom(request);
    const { dish } = cartFor(menu);
    // The 10 % coupon needs a 15 € cart; two such orders bring the 100 XP of level 2.
    const quantity = Math.max(cartFor(menu).quantity, Math.ceil(1500 / dish.priceCents));
    const account = await registerVerified(request);
    const api = await CustomerApi.signIn(request, account);

    await test.step('two orders arrive: level 2, one spin', async () => {
        const orders = [
            await api.order(menu.restaurant, dish, quantity),
            await api.order(menu.restaurant, dish, quantity),
        ];
        for (const order of orders) {
            await expect.poll(() => api.orderStatus(order), {
                timeout: 240_000,
                intervals: [2_000],
            }).toBe('DELIVERED');
        }
        await expect.poll(() => api.spinsAvailable(), { timeout: 60_000 }).toBe(1);
    });

    await test.step('spin the wheel', async () => {
        await signIn(page, account);
        await page.goto('/account/rewards');
        await expect(page.getByText('Du hast einen Dreh.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Drehen' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Gewonnen: 10 % Rabatt' })).toBeVisible({ timeout: 30_000 });
    });

    const [coupon] = await api.coupons();
    expect(coupon?.kind).toBe('PERCENT');

    await test.step('redeem it at checkout', async () => {
        const cart = await request.put(`/api/ordering/v1/cart/items/${dish.id}`, {
            headers: { authorization: `Bearer ${api.token}` },
            params: { lang: 'de' },
            data: { quantity, replaceCart: true },
        });
        expect(cart.ok(), await cart.text()).toBe(true);
        await page.getByRole('link', { name: 'Gutschein im Warenkorb einlösen' }).click();
        await page.getByRole('button', { name: `Gutschein ${coupon!.code} einlösen` }).click();
        await expect(page.getByRole('button', { name: 'Gutschein entfernen' })).toBeVisible();
        await page.getByRole('button', { name: 'Mit Willenskraft bezahlen' }).click();
        await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
    });

    await test.step('the order is cheaper, and the coupon is used up', async () => {
        const orderId = page.url().split('/').at(-1)!;
        const order = await api.orderDetails(orderId);
        expect(order.couponCode).toBe(coupon!.code);
        // 10 % of the dishes, give or take loyalty's rounding.
        expect(Math.abs(order.discountCents - order.subtotalCents * 0.1)).toBeLessThanOrEqual(1);
        expect(order.discountCents).toBeGreaterThan(0);
        await expect.poll(async () => (await api.coupons()).map(it => it.code)).not.toContain(coupon!.code);
    });
});
