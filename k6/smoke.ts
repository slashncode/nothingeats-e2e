// Smoke load on the read paths a visitor hits first: a few users browse, open menus and search for
// half a minute. Not a load test; it fails the run when anything errors or reads get slow.
// k6 run k6/smoke.ts (BASE_URL overrides the local cluster)
import type { Options } from 'k6/options';
import { check, group, sleep } from 'k6';
import http from 'k6/http';

const base = __ENV.BASE_URL ?? 'http://nothingeats.localhost';
const api = {
    tags: { kind: 'api' },
};
const ok = {
    'status 200': (response: { status: number }) => response.status === 200,
};

export const options: Options = {
    scenarios: {
        visitors: { executor: 'constant-vus', vus: 5, duration: '30s' },
    },
    thresholds: {
        'checks': ['rate==1'],
        'http_req_failed': ['rate==0'],
        'http_req_duration{kind:api}': ['p(95)<500'],
    },
};

export default function visitor() {
    group('shop', () => {
        check(http.get(`${base}/`), ok);
        check(http.get(`${base}/env.js`), ok);
    });

    group('browse', () => {
        const restaurants = http.get(`${base}/api/catalog/v1/restaurants?limit=20`, api);
        check(restaurants, {
            ...ok,
            'restaurants listed': response => (response.json('items') as unknown[]).length > 0,
        });
        const slugs = restaurants.json('items.#.slug') as string[];
        const slug = slugs[Math.floor(Math.random() * slugs.length)];
        check(http.get(`${base}/api/catalog/v1/restaurants/${slug}`, api), ok);
        check(http.get(`${base}/api/catalog/v1/deals`, api), ok);
    });

    group('search', () => {
        const query = [
            'pizza',
            'curry',
            'vegan',
            'pommes',
            'sushi',
        ][Math.floor(Math.random() * 5)];
        check(http.get(`${base}/api/search/v1/dishes?q=${query}`, api), ok);
        check(http.get(`${base}/api/search/v1/suggestions?q=${query!.slice(0, 3)}`, api), ok);
    });

    sleep(1);
}
