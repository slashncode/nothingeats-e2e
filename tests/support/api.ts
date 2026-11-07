import type { APIRequestContext } from '@playwright/test';
import type { Account } from './accounts.ts';
import type { Dish, Restaurant } from './shop.ts';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

/** The shop's APIs as a signed-in customer, for tests whose subject is not the page. */
export class CustomerApi {
    private constructor(
        private readonly request: APIRequestContext,
        readonly token: string,
    ) {}

    static async signIn(request: APIRequestContext, account: Account): Promise<CustomerApi> {
        const session = await request.post('/api/identity/v1/sessions', { data: account });
        expect(session.ok(), await session.text()).toBe(true);
        const { accessToken } = await session.json() as { accessToken: string };
        return new CustomerApi(request, accessToken);
    }

    private get headers() {
        return { authorization: `Bearer ${this.token}` };
    }

    private async json<T>(path: string): Promise<T> {
        const response = await this.request.get(path, { headers: this.headers });
        expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
        return await response.json() as T;
    }

    /** A fresh cart with [quantity] × [dish], checked out to Sternschanze. Returns the order id. */
    async order(restaurant: Restaurant, dish: Dish, quantity: number): Promise<string> {
        const cart = await this.request.put(`/api/ordering/v1/cart/items/${dish.id}`, {
            headers: this.headers,
            params: { lang: 'de' },
            data: { quantity, replaceCart: true },
        });
        expect(cart.ok(), `cart at ${restaurant.slug}: ${await cart.text()}`).toBe(true);
        const placed = await this.request.post('/api/ordering/v1/orders', {
            headers: {
                ...this.headers,
                'Idempotency-Key': randomUUID(),
            },
            params: { lang: 'de' },
            data: {
                dropOff: { latitude: 53.5636, longitude: 9.9654, label: 'Sternschanze' },
            },
        });
        expect(placed.status(), await placed.text()).toBe(201);
        return (await placed.json() as { id: string }).id;
    }

    async orderStatus(orderId: string): Promise<string> {
        return (await this.json<{ status: string }>(`/api/ordering/v1/orders/${orderId}`)).status;
    }

    /** `delivery` when delivery-service quoted the order, `estimate` when checkout had to guess. */
    async quoteSource(orderId: string): Promise<string> {
        return (await this.json<{ quoteSource: string }>(`/api/ordering/v1/orders/${orderId}`)).quoteSource;
    }

    async orderCount(): Promise<number> {
        return (await this.json<{ items: unknown[] }>('/api/ordering/v1/orders')).items.length;
    }

    /** The delivery's own step; 404 for a moment right after checkout. */
    async deliveryStatus(orderId: string): Promise<string | undefined> {
        const response = await this.request.get(`/api/delivery/v1/deliveries/${orderId}`, { headers: this.headers });
        return response.ok()
            ? (await response.json() as { status: string }).status
            : undefined;
    }

    /** The order as the customer sees it, with its discount and coupon. */
    async orderDetails(orderId: string): Promise<{ status: string; discountCents: number; couponCode: string | null; subtotalCents: number }> {
        return this.json(`/api/ordering/v1/orders/${orderId}`);
    }

    /** Spins left on the wheel, as loyalty counts them. */
    async spinsAvailable(): Promise<number> {
        return (await this.json<{ spinsAvailable: number }>('/api/loyalty/v1/me')).spinsAvailable;
    }

    /** Coupons loyalty still holds for the customer. */
    async coupons(): Promise<{ code: string; kind: string }[]> {
        return (await this.json<{ items: { code: string; kind: string }[] }>('/api/loyalty/v1/coupons')).items;
    }

    /** Delivered orders as loyalty counted them. */
    async rewardedOrders(): Promise<number> {
        return (await this.json<{ stats: { orders: number } }>('/api/loyalty/v1/me')).stats.orders;
    }
}
