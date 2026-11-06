import process from 'node:process';

/**
 * Where the shop runs. The defaults are the local cluster's names; the CI cluster uses the same
 * ones (the workflow maps them to 127.0.0.1), so a test never knows which cluster it is in.
 */
export const baseUrl = process.env.BASE_URL ?? 'http://nothingeats.localhost';
export const mailpitUrl = process.env.MAILPIT_URL ?? 'http://mail.nothingeats.localhost';

/**
 * Set by the workflow: the cluster lives for one run, so a test may change content an admin
 * would change (e.g. open a restaurant when the test runs at night). Never set it for the local
 * cluster, where that content is yours.
 */
export const disposableCluster = process.env.E2E_DISPOSABLE_CLUSTER === 'true';

/** identity makes this address an admin (`ADMIN__EMAILS` in nothingeats-gitops). */
export const admin = {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@nothingeats.dev',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'correct horse battery',
};
