# CLAUDE.md

System tests for NothingEats: a throwaway k3d cluster built by Flux from nothingeats-gitops (`clusters/ci`), tested with Playwright and k6. The cross-repo plan and session rules live in `../CLAUDE.md` (workspace root), if present — read it first.

## Commands

Tools from `mise.toml` (`mise exec -- …`).

- `pnpm test` — Playwright against `BASE_URL` (default: the local cluster, `http://nothingeats.localhost`)
- `pnpm smoke` — k6 smoke run against the same
- `pnpm lint` / `pnpm typecheck`
- `scripts/cluster-up.sh <gitops checkout>` — the CI cluster `k3d-nothingeats-ci` (needs port 80: stop the local cluster first); `scripts/diagnose.sh <dir>` dumps its state

## Rules

- Tests read like a customer: roles and visible German texts, never CSS classes or test ids. Texts come from nothingeats-web's `de.json` and nothingeats-ui's `strings.tsx`.
- A test never changes content on a cluster that is not disposable. Changes an admin would make (e.g. opening a restaurant at night) only with `E2E_DISPOSABLE_CLUSTER=true`, which only the workflow sets.
- New accounts per run stay few: identity allows 10 registrations an hour per address. Tests that only need someone signed in use the `customer` fixture (one per worker).
- Wait on what the customer sees (`expect(...).toBeVisible()`, `expect.poll`), never on fixed sleeps. No retries: a flaky test is a finding.
- The CI cluster has no outside services (no PostHog, no OpenAI): never add a test that needs one.
- A new secret in nothingeats-gitops needs a line in its `clusters/ci/secrets.sh`, or the CI cluster never starts the pod that reads it.
