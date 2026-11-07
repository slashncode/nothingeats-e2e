import type { APIRequestContext } from '@playwright/test';
import type { Account } from '../support/accounts.ts';
import process from 'node:process';
import { registerVerified, signIn } from '../support/accounts.ts';
import { CustomerApi } from '../support/api.ts';
import { disposableCluster } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';
import { crash, kafkaBroker, ready, service } from '../support/kube.ts';
import { countMails, waitForMail } from '../support/mailpit.ts';
import { cartFor, restaurantToOrderFrom } from '../support/shop.ts';

// Parts of the cluster crash in the middle of an order. The customer may wait a little longer,
// nothing else: the order arrives, and it arrives once (one order, one confirmation, one delivery
// mail, one order counted by loyalty). These tests kill pods, so only on a disposable cluster.
test.skip(!disposableCluster, 'Chaos only on a disposable cluster');
test.describe.configure({ mode: 'serial' });

/** A duplicate shows up within seconds of the original; give it that chance before counting. */
const DUPLICATE_WINDOW_MS = 5_000;
const ON_THE_WAY = /^(PICKED_UP|EN_ROUTE)$/;

/** Logs how long each stage took after the crash, so a slow recovery shows where it waits. */
function timeline() {
    const start = Date.now();
    return (stage: string) => process.stdout.write(`  ${stage} after ${Math.round((Date.now() - start) / 1000)} s\n`);
}

async function newCustomer(request: APIRequestContext) {
    const account = await registerVerified(request);
    const menu = await restaurantToOrderFrom(request);
    return {
        account,
        api: await CustomerApi.signIn(request, account),
        menu,
        ...cartFor(menu),
    };
}

async function expectDeliveredOnce(
    api: CustomerApi,
    account: Account,
    orderId: string,
    restaurantName: string,
    since: (stage: string) => void = () => {},
) {
    await expect.poll(() => api.orderStatus(orderId), {
        message: 'the order arrives',
        timeout: 240_000,
        intervals: [1_000, 2_000],
    }).toBe('DELIVERED');
    since('ordering has it delivered');
    await waitForMail(account.email, /^Dein Nichts ist da$/);
    since('delivery mail sent');
    await expect.poll(() => api.rewardedOrders(), { message: 'loyalty counts the order', timeout: 60_000 }).toBe(1);
    since('loyalty counted it');

    await new Promise(resolve => setTimeout(resolve, DUPLICATE_WINDOW_MS));
    expect(await api.orderCount(), 'orders').toBe(1);
    expect(await countMails(account.email, new RegExp(`^Bestellt bei ${restaurantName}`)), 'confirmation mails').toBe(1);
    expect(await countMails(account.email, /^Dein Nichts ist da$/), 'delivery mails').toBe(1);
    expect(await api.rewardedOrders(), 'orders counted by loyalty').toBe(1);
}

test('the courier keeps going when delivery-service crashes', async ({ request }) => {
    const { account, api, menu, dish, quantity } = await newCustomer(request);
    const orderId = await api.order(menu.restaurant, dish, quantity);
    await expect.poll(() => api.deliveryStatus(orderId), {
        timeout: 60_000,
        intervals: [500],
    }).toMatch(ON_THE_WAY);

    // The ticker that moves deliveries along lives in these pods; the plans live in Postgres.
    crash(service('delivery-service'));

    await expectDeliveredOnce(api, account, orderId, menu.restaurant.name);

    // Checkout asks the new pod for quotes again, instead of guessing on a dead connection.
    const next = await api.order(menu.restaurant, dish, quantity);
    expect(await api.quoteSource(next), 'quote after the restart').toBe('delivery');
});

test('an order placed while Kafka is down arrives once', async ({ request }) => {
    const { account, api, menu, dish, quantity } = await newCustomer(request);
    const since = timeline();

    crash(kafkaBroker);
    // Checkout needs no broker: the event waits in ordering's outbox until Kafka is back.
    const orderId = await api.order(menu.restaurant, dish, quantity);
    since(`order placed (quote: ${await api.quoteSource(orderId)})`);

    // Meanwhile the shop keeps answering: browsing and search need no broker either.
    const unavailable: string[] = [];
    await expect.poll(async () => {
        for (const path of ['/api/catalog/v1/restaurants', '/api/search/v1/dishes?q=pizza', `/api/delivery/v1/deliveries/${orderId}`]) {
            const response = await request.get(path, {
                headers: { authorization: `Bearer ${api.token}` },
            });
            if (response.status() >= 500)
                unavailable.push(`${path} ${response.status()}`);
        }
        return ready(kafkaBroker);
    }, {
        timeout: 180_000,
        intervals: [2_000],
    }).toBe(true);
    since('Kafka ready again');
    expect(unavailable, 'answers while Kafka was down').toEqual([]);
    await expect.poll(() => api.deliveryStatus(orderId), {
        timeout: 240_000,
        intervals: [1_000],
    }).toBeDefined();
    since('delivery has the order');
    await expect.poll(() => api.deliveryStatus(orderId), {
        timeout: 240_000,
        intervals: [1_000],
    }).toBe('DELIVERED');
    since('the courier arrived (delivery)');

    await expectDeliveredOnce(api, account, orderId, menu.restaurant.name, since);
    since('delivered once');
});

test('the tracking page sees the arrival although notification-service crashed', async ({ page, request }) => {
    const { account, api, menu, dish, quantity } = await newCustomer(request);
    await signIn(page, account);
    const orderId = await api.order(menu.restaurant, dish, quantity);
    await page.goto(`/orders/${orderId}`);
    await expect.poll(() => api.deliveryStatus(orderId), {
        timeout: 60_000,
        intervals: [500],
    }).toMatch(ON_THE_WAY);

    // The page's live stream ends with the pod; the arrival happens while it reconnects.
    crash(service('notification-service'));

    await expect(page.getByText('Nichts ist angekommen. Guten Appetit!')).toBeVisible({ timeout: 180_000 });
    await expectDeliveredOnce(api, account, orderId, menu.restaurant.name);
});
