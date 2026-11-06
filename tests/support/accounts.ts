import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { admin, disposableCluster } from './env.ts';
import { linkTo, waitForMail } from './mailpit.ts';

export interface Account {
    email: string;
    password: string;
}

/** A fresh address for every account: Mailpit catches all mail, so the domain never matters. */
export function newAccount(): Account {
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return { email: `e2e-${unique}@nothingeats.dev`, password: 'nothing to see here' };
}

/**
 * Registers and verifies through the API and Mailpit, for tests about something else.
 * identity allows 10 registrations an hour from one address, so tests share accounts.
 */
export async function registerVerified(request: APIRequestContext, account = newAccount()): Promise<Account> {
    const registered = await request.post('/api/identity/v1/registrations', {
        data: { ...account, locale: 'de' },
    });
    expect(registered.ok(), await registered.text()).toBe(true);
    const mail = await waitForMail(account.email, /bestätige deine E-Mail-Adresse/);
    const token = new URL(linkTo(mail, '/verify')).searchParams.get('token');
    const verified = await request.post('/api/identity/v1/verifications', {
        data: { token },
    });
    expect(verified.ok(), await verified.text()).toBe(true);
    return account;
}

export async function signIn(page: Page, account: Account): Promise<void> {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'E-Mail' }).fill(account.email);
    await page.getByLabel('Passwort').fill(account.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
}

/**
 * An access token of the admin account, for the backoffice's API. A fresh CI cluster has no
 * accounts yet, so there the admin registers first, like on day one of a real shop.
 */
export async function adminToken(request: APIRequestContext): Promise<string> {
    let session = await request.post('/api/identity/v1/sessions', { data: admin });
    if (session.status() === 401 && disposableCluster) {
        await registerVerified(request, admin);
        session = await request.post('/api/identity/v1/sessions', { data: admin });
    }
    expect(session.ok(), `admin login: ${await session.text()}`).toBe(true);
    const { accessToken } = await session.json() as { accessToken: string };
    return accessToken;
}
