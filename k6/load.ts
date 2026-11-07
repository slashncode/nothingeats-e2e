// Load test: how much traffic the cluster takes before it bends. Visitors arrive at a rate that
// climbs in steps (open the shop, browse, open a menu, deals, search, suggestions); every request
// is tagged with its step, and a step whose p95 passes a second or whose errors pass 1 % ends the
// run. The table at the end shows each step, so the last one is where it bends.
//
// k6 run k6/load.ts                     read paths only; changes nothing
// ORDERS=true k6 run k6/load.ts         also checkouts at a tenth of the visitor rate (4 accounts
//                                       `load-<n>@nothingeats.dev`, registered once through Mailpit;
//                                       every order is a real order with mails and a delivery)
//
// k6 runs on the same machine as the cluster and takes its share of the CPU. The Craving Coach is
// left out on purpose: locally it calls OpenAI.
import type { Options } from 'k6/options';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';

const base = __ENV.BASE_URL ?? 'http://nothingeats.localhost';
const mailpit = __ENV.MAILPIT_URL ?? 'http://mail.nothingeats.localhost';
const orders = __ENV.ORDERS === 'true';

/** Visitors per second at each step (STEPS=600 runs one); checkouts run at a tenth. */
const STEPS = (__ENV.STEPS ?? '10,25,50,100,200,300,400,600,800').split(',').map(Number);
const RAMP_SECONDS = 10;
const HOLD_SECONDS = 50;
const CUSTOMERS = 4;
const PASSWORD = 'nothing to see here';
// Enough variety that the caches (Elasticsearch's request cache, the catalog's) cannot answer everything.
const WORDS = [
    'pizza',
    'curry',
    'vegan',
    'pommes',
    'sushi',
    'scharf',
    'burger',
    'suppe',
    'dessert',
    'trüffel',
    'käse',
    'reis',
    'nudeln',
    'salat',
    'hähnchen',
    'tofu',
    'knusprig',
    'süß',
    'gyros',
    'ramen',
    'tacos',
    'kokos',
    'mango',
    'linsen',
    'spinat',
    'pilze',
    'lachs',
    'falafel',
    'eis',
    'brot',
];
const FILTERS = [
    '',
    '',
    '&diet=vegan',
    '&diet=vegetarian',
    '&cuisine=italian',
    '&cuisine=asian',
    '&maxSpice=1',
    '&maxPrice=1200',
    '&openNow=true',
    '&excludeAllergen=gluten',
    '&lang=en',
];

function pick<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)]!;
}

function stages(scale: number) {
    return STEPS.flatMap(rate => [
        { target: rate * scale, duration: `${RAMP_SECONDS}s` },
        { target: rate * scale, duration: `${HOLD_SECONDS}s` },
    ]);
}

/** The step the scenario is in now; requests carry it as the `step` tag. */
function step(): string {
    const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
    const index = Math.min(Math.floor(elapsed / (RAMP_SECONDS + HOLD_SECONDS)), STEPS.length - 1);
    return String(STEPS[index]);
}

function perStep(threshold: string) {
    return Object.fromEntries(STEPS.map(rate => [
        `http_req_duration{kind:api,step:${rate}}`,
        [
            { threshold, abortOnFail: true, delayAbortEval: '15s' },
        ],
    ]));
}

export const options: Options = {
    scenarios: {
        visitors: {
            executor: 'ramping-arrival-rate',
            exec: 'visitor',
            startRate: 1,
            timeUnit: '1s',
            stages: stages(1),
            preAllocatedVUs: 50,
            maxVUs: 600,
        },
        ...(orders
            ? {
                    customers: {
                        executor: 'ramping-arrival-rate',
                        exec: 'customer',
                        startRate: 0,
                        timeUnit: '1s',
                        stages: stages(0.1),
                        preAllocatedVUs: 10,
                        maxVUs: 100,
                    },
                }
            : {}),
    },
    thresholds: {
        ...perStep('p(95)<1000'),
        ...Object.fromEntries(STEPS.map(rate => [
            `http_req_failed{step:${rate}}`,
            [
                { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '15s' },
            ],
        ])),
        ...Object.fromEntries(STEPS.map(rate => [`http_req_duration{kind:order,step:${rate}}`, []])),
    },
    summaryTrendStats: [
        'med',
        'p(95)',
        'p(99)',
        'max',
        'count',
    ],
};

/** [path] with its query; the `name` tag groups requests by path, not by every query string. */
function get(path: string, kind: 'api' | 'page' = 'api') {
    return http.get(`${base}${path}`, {
        tags: {
            kind,
            step: step(),
            name: path.split('?')[0]!.replace(/\/restaurants\/[^/]+$/, '/restaurants/{slug}'),
        },
    });
}

const ok = {
    'status 200': (response: { status: number }) => response.status === 200,
};

export function visitor() {
    check(get('/', 'page'), ok);
    const restaurants = get('/api/catalog/v1/restaurants?limit=20');
    check(restaurants, ok);
    const slugs = restaurants.status === 200
        ? restaurants.json('items.#.slug') as string[]
        : [];
    if (slugs.length > 0)
        check(get(`/api/catalog/v1/restaurants/${pick(slugs)}`), ok);
    check(get('/api/catalog/v1/deals'), ok);
    const query = Math.random() < 0.3
        ? `${pick(WORDS)} ${pick(WORDS)}`
        : pick(WORDS);
    check(get(`/api/search/v1/suggestions?q=${encodeURIComponent(query.slice(0, 2 + Math.floor(Math.random() * 3)))}`), ok);
    check(get(`/api/search/v1/dishes?q=${encodeURIComponent(query)}${pick(FILTERS)}`), ok);
}

interface Customer {
    token: string;
}

interface Setup {
    customers: Customer[];
    dish?: { id: string; quantity: number };
}

const setupJson = {
    headers: { 'Content-Type': 'application/json' },
    tags: { kind: 'setup' },
};

/** Polls Mailpit for the verification mail to [email] and returns the token from its link. */
function verificationToken(email: string): string {
    for (let attempt = 0; attempt < 30; attempt++) {
        const search = http.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, {
            tags: { kind: 'setup' },
        });
        const id = (search.json('messages') as { ID: string; Subject: string }[] | undefined)
            ?.find(message => /bestätige deine E-Mail-Adresse/.test(message.Subject))
            ?.ID;
        if (id) {
            const text = http.get(`${mailpit}/api/v1/message/${id}`, {
                tags: { kind: 'setup' },
            }).json('Text') as string;
            const link = text.match(/https?:\/\/\S+/g)?.find(url => url.includes('/verify?'));
            const token = link?.match(/token=([^&\s]+)/)?.[1];
            if (token)
                return decodeURIComponent(token);
        }
        sleep(1);
    }
    return fail(`no verification mail to ${email}`);
}

/** Signs in, registering and verifying the account first when it does not exist yet. */
function signIn(email: string): Customer {
    const body = JSON.stringify({ email, password: PASSWORD });
    let session = http.post(`${base}/api/identity/v1/sessions`, body, setupJson);
    if (session.status === 401) {
        const registration = JSON.stringify({ email, password: PASSWORD, locale: 'de' });
        const registered = http.post(`${base}/api/identity/v1/registrations`, registration, setupJson);
        if (registered.status >= 300)
            fail(`registering ${email}: ${registered.status} ${registered.body}`);
        const verification = JSON.stringify({
            token: verificationToken(email),
        });
        http.post(`${base}/api/identity/v1/verifications`, verification, setupJson);
        session = http.post(`${base}/api/identity/v1/sessions`, body, setupJson);
    }
    if (session.status !== 200)
        fail(`signing in ${email}: ${session.status} ${session.body}`);
    return {
        token: session.json('accessToken') as string,
    };
}

/** The most expensive dish of an open restaurant, as often as its minimum order needs. */
function dishToOrder(): Setup['dish'] {
    const restaurants = http.get(`${base}/api/catalog/v1/restaurants?limit=50`, {
        tags: { kind: 'setup' },
    })
        .json('items') as { slug: string; openNow: boolean; minimumOrderCents: number }[];
    const open = restaurants.find(it => it.openNow);
    if (!open)
        return undefined;
    const menu = http.get(`${base}/api/catalog/v1/restaurants/${open.slug}`, {
        tags: { kind: 'setup' },
    })
        .json('sections') as { dishes: { id: string; priceCents: number }[] }[];
    const dish = menu.flatMap(section => section.dishes).toSorted((a, b) => b.priceCents - a.priceCents)[0]!;
    return {
        id: dish.id,
        quantity: Math.ceil(open.minimumOrderCents / dish.priceCents),
    };
}

export function setup(): Setup {
    if (!orders)
        return { customers: [] };
    const dish = dishToOrder();
    if (!dish)
        fail('ORDERS=true, but every restaurant is closed right now');
    const customers = Array.from({ length: CUSTOMERS }, (_, n) => signIn(`load-${n + 1}@nothingeats.dev`));
    return { customers, dish };
}

export function customer(data: Setup) {
    const { token } = data.customers[exec.scenario.iterationInTest % data.customers.length]!;
    const tags = {
        kind: 'order',
        step: step(),
    };
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const cart = http.put(
        `${base}/api/ordering/v1/cart/items/${data.dish!.id}?lang=de`,
        JSON.stringify({ quantity: data.dish!.quantity, replaceCart: true }),
        { headers, tags },
    );
    check(cart, ok);
    const placed = http.post(
        `${base}/api/ordering/v1/orders?lang=de`,
        JSON.stringify({
            dropOff: { latitude: 53.5636, longitude: 9.9654, label: 'Sternschanze' },
        }),
        {
            headers: { ...headers, 'Idempotency-Key': `load-${exec.scenario.iterationInTest}-${Date.now()}` },
            tags,
        },
    );
    check(placed, {
        'order placed': response => response.status === 201,
    });
}

interface Trend { values: Record<string, number> }

export function handleSummary(data: { metrics: Record<string, Trend> }) {
    const ms = (value: number | undefined) => value === undefined
        ? '-'
        : `${Math.round(value)} ms`;
    const rows = STEPS.flatMap((rate) => {
        const api = data.metrics[`http_req_duration{kind:api,step:${rate}}`]?.values;
        if (!api?.count)
            return [];
        const failed = data.metrics[`http_req_failed{step:${rate}}`]?.values.rate ?? 0;
        const order = data.metrics[`http_req_duration{kind:order,step:${rate}}`]?.values;
        return [`| ${rate}/s | ${api.count} | ${ms(api.med)} | ${ms(api['p(95)'])} | ${ms(api['p(99)'])} | ${(failed * 100).toFixed(2)} % | ${order?.count
            ? ms(order['p(95)'])
            : '-'} |`];
    });
    const table = [
        '',
        '| Visitors | API requests | median | p95 | p99 | failed | checkout p95 |',
        '|---|---|---|---|---|---|---|',
        ...rows,
        '',
    ].join('\n');
    // SUMMARY_FILE: also as Markdown for the workflow's job summary.
    return {
        stdout: table,
        ...(__ENV.SUMMARY_FILE
            ? { [__ENV.SUMMARY_FILE]: table }
            : {}),
    };
}
