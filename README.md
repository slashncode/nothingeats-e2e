# nothingeats-e2e

System tests for [NothingEats](https://github.com/slashncode/nothingeats): the whole shop runs in a
throwaway Kubernetes cluster and gets tested the way a customer uses it.

## What a run does

1. **A cluster from git.** `scripts/cluster-up.sh` creates a k3d cluster on the runner, installs
   Flux and points it at one commit of
   [nothingeats-gitops](https://github.com/slashncode/nothingeats-gitops) (`clusters/ci`). Flux builds
   everything the local cluster has: Traefik, Postgres, Kafka, Elasticsearch, Valkey, Garage,
   Mailpit and all services. Flux only reads the repo here; it never commits.
2. **No secrets of ours.** The CI cluster never sees the SOPS key. `clusters/ci` drops every
   encrypted secret, and `clusters/ci/secrets.sh` creates the same secrets with random values that
   live as long as the cluster. PostHog and OpenAI get no keys at all: the coach runs its scripted
   model and search embeds with feature hashing, so a run costs nothing and pollutes no analytics.
3. **Faster deliveries.** The CI cluster runs the delivery simulation at time scale 0.02: a
   30-minute delivery takes 36 seconds.
4. **Playwright** (`tests/`) goes through the shop in a browser: register, confirm the mail from
   Mailpit, sign in, fill the cart, pay with willpower, watch nothing arrive on the live stream,
   get the mails and the first badge. Plus search (compound suggestions, facets), the Craving
   Coach, a forgotten password from the mail to the new one, the backoffice, and (disposable
   cluster only, the admin sets the wheel's odds) level 2 from two orders, a spin, and a coupon
   that makes the next order 10 % cheaper. Every seeded restaurant is closed at night, so on a CI cluster the admin first opens
   Phantom Pizza around the clock through the backoffice, which also tests that path.
5. **k6** (`k6/smoke.ts`): five visitors browse and search for 30 seconds; any error or a p95
   above 500 ms fails the run.

6. **Load** (`k6/load.ts`, by hand: Actions -> load): visitors arrive at a rate that climbs in
   one-minute steps (10 to 800 a second; each visitor opens the shop, a restaurant list, a menu,
   the deals, a suggestion and a search with varied words and filters), optionally with checkouts
   at a tenth of that rate. A step whose p95 passes a second or whose errors pass 1 % ends the run;
   the job summary shows each step and every pod that restarted.

A failed run uploads the Playwright report with traces and videos, and the cluster's Flux state,
events and pod logs.

## When it runs

- On every push and pull request here, and every night against nothingeats-gitops `main`.
- From nothingeats-gitops for its own changes: it calls the reusable workflow
  `.github/workflows/system-tests.yml` with the commit under test.
- By hand: Actions -> ci -> Run workflow, with any gitops branch or commit.

## Locally

Tools come from `mise.toml` (`mise install`).

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test        # against the local cluster at nothingeats.localhost
pnpm smoke       # k6 against the same
pnpm load        # the stepped load test, read paths only: changes nothing (STEPS=400,600 picks steps)
```

`ORDERS=true pnpm load` adds checkouts by four accounts `load-<n>@nothingeats.dev`. Every order is
real, with mails, a delivery and rewards, so that belongs on a throwaway cluster (the `load`
workflow), not on the local one. k6 runs on the same machine as a local cluster and takes its
share of the CPU.

Against the local cluster the tests use the content that is there and never change it: the order
test takes any open restaurant (and skips when all are closed), and new accounts are
`e2e-…@nothingeats.dev`. identity allows ten registrations an hour from one address; a run makes
two. `BASE_URL` and `MAILPIT_URL` point the tests elsewhere.

The CI cluster can also run on a laptop, instead of the local one (both want port 80):

```sh
k3d cluster stop nothingeats
scripts/cluster-up.sh ../nothingeats-gitops
E2E_DISPOSABLE_CLUSTER=true pnpm test
k3d cluster delete nothingeats-ci && k3d cluster start nothingeats
```

## License

MIT
