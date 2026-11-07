import { request } from '@playwright/test';
import { adminToken } from './support/accounts.ts';
import { baseUrl, disposableCluster } from './support/env.ts';

/**
 * A fresh CI cluster has no admin yet. Register it once here, before tests in parallel workers
 * race to do it (the second registration of an address sends no mail to confirm).
 */
export default async function globalSetup() {
    if (!disposableCluster)
        return;
    const context = await request.newContext({ baseURL: baseUrl });
    await adminToken(context);
    await context.dispose();
}
