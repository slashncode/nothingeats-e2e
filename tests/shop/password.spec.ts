import { registerVerified, signIn } from '../support/accounts.ts';
import { expect, test } from '../support/fixtures.ts';
import { linkTo, waitForMail } from '../support/mailpit.ts';

// Forgotten password, the whole way: identity -> notification (two mails) -> identity.
test('a customer who forgot the password sets a new one from the mail', async ({ page, request }) => {
    const account = await registerVerified(request);
    const newPassword = 'something else entirely';

    await test.step('ask for a link', async () => {
        await page.goto('/login');
        await page.getByRole('link', { name: 'Passwort vergessen?' }).click();
        await expect(page.getByRole('heading', { name: 'Passwort vergessen' })).toBeVisible();
        await page.getByRole('textbox', { name: 'E-Mail' }).fill(account.email);
        await page.getByRole('button', { name: 'Link schicken' }).click();
        await expect(page.getByText(/ist ein Link unterwegs/)).toBeVisible();
    });

    const link = await test.step('the link from the mail', async () => {
        const mail = await waitForMail(account.email, /^Neues Passwort für NothingEats$/);
        return linkTo(mail, '/reset-password');
    });

    await test.step('set a new password', async () => {
        await page.goto(link);
        await page.getByLabel('Neues Passwort').fill(newPassword);
        await page.getByRole('button', { name: 'Passwort speichern' }).click();
        await expect(page.getByText('Dein Passwort ist geändert.', { exact: false })).toBeVisible();
        await waitForMail(account.email, /^Dein Passwort wurde geändert$/);
    });

    await test.step('the link works once', async () => {
        await page.goto(link);
        await page.getByLabel('Neues Passwort').fill('yet another password');
        await page.getByRole('button', { name: 'Passwort speichern' }).click();
        await expect(page.getByText('Dieser Link ist ungültig, abgelaufen oder schon benutzt worden.')).toBeVisible();
    });

    await test.step('only the new password signs in', async () => {
        const old = await request.post('/api/identity/v1/sessions', { data: account });
        expect(old.status()).toBe(401);
        await signIn(page, { ...account, password: newPassword });
    });
});
