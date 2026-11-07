import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { adminToken } from './accounts.ts';
import { disposableCluster } from './env.ts';

export interface Restaurant {
    slug: string;
    name: string;
    openNow: boolean;
    minimumOrderCents: number;
}

export interface Dish {
    id: string;
    name: string;
    priceCents: number;
}

/** The most expensive dish of the menu, as often as the minimum order needs. */
export function cartFor({ restaurant, sections }: { restaurant: Restaurant; sections: { dishes: Dish[] }[] }) {
    const dish = sections.flatMap(section => section.dishes).toSorted((a, b) => b.priceCents - a.priceCents)[0]!;
    return {
        dish,
        quantity: Math.ceil(restaurant.minimumOrderCents / dish.priceCents),
    };
}

/** The restaurant the CI order goes to: Phantom Pizza, from the backoffice's seed. */
const OPEN_ALL_DAY = 'phantom-pizza';

async function restaurant(request: APIRequestContext, slug: string) {
    const response = await request.get(`/api/catalog/v1/restaurants/${slug}`);
    expect(response.ok(), await response.text()).toBe(true);
    return await response.json() as { restaurant: Restaurant; sections: { dishes: Dish[] }[] };
}

/**
 * A restaurant that takes orders right now, with its menu. Every seeded restaurant is closed
 * between 2:00 and 10:30, so on a CI cluster the admin opens Phantom Pizza around the clock
 * through the backoffice first, like an admin would: that also proves a published change travels
 * backoffice -> catalog -> ordering. On any other cluster the test takes whatever is open.
 */
export async function restaurantToOrderFrom(request: APIRequestContext) {
    if (disposableCluster) {
        await openAroundTheClock(request, OPEN_ALL_DAY);
        return restaurant(request, OPEN_ALL_DAY);
    }
    const { items } = await (await request.get('/api/catalog/v1/restaurants?limit=50')).json() as { items: Restaurant[] };
    const open = items.find(it => it.openNow);
    test.skip(!open, 'Every restaurant is closed right now; this cluster is not ours to change.');
    return restaurant(request, open!.slug);
}

async function openAroundTheClock(request: APIRequestContext, slug: string) {
    const headers = { authorization: `Bearer ${await adminToken(request)}` };
    // The backoffice knows an admin from their first sign-in there, as its login form does it.
    const session = await request.post('/api/backoffice/admins/session', { headers });
    expect(session.ok(), `backoffice sign-in: ${await session.text()}`).toBe(true);

    const found = await request.get('/api/backoffice/restaurants', {
        headers,
        params: { 'where[slug][equals]': slug, 'depth': 0 },
    });
    expect(found.ok(), await found.text()).toBe(true);
    const { docs } = await found.json() as { docs: { id: string }[] };
    expect(docs, `restaurant ${slug} in the backoffice`).toHaveLength(1);

    const published = await request.patch(`/api/backoffice/restaurants/${docs[0]!.id}`, {
        headers,
        params: { publishAllLocales: 'true' },
        data: { opensAt: '00:00', closesAt: '23:59', _status: 'published' },
    });
    expect(published.ok(), await published.text()).toBe(true);

    await expect.poll(async () => (await restaurant(request, slug)).restaurant.openNow, {
        message: `${slug} open in the catalog`,
        timeout: 30_000,
    }).toBe(true);
}
