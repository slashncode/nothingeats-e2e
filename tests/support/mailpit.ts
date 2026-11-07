import { expect } from '@playwright/test';
import { mailpitUrl } from './env.ts';

export interface Mail {
    subject: string;
    text: string;
}

interface MessageSummary {
    ID: string;
    Subject: string;
}

async function mailsTo(to: string): Promise<MessageSummary[]> {
    const response = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    return (await response.json() as { messages: MessageSummary[] }).messages;
}

/** How many mails to [to] have a subject that matches. */
export async function countMails(to: string, subject: RegExp): Promise<number> {
    return (await mailsTo(to)).filter(message => subject.test(message.Subject)).length;
}

/** Waits until Mailpit holds a mail to [to] whose subject matches, and returns it. */
export async function waitForMail(to: string, subject: RegExp, timeout = 60_000): Promise<Mail> {
    let id: string | undefined;
    await expect.poll(async () => {
        id = (await mailsTo(to)).find(message => subject.test(message.Subject))?.ID;
        return id;
    }, {
        message: `a mail to ${to} with the subject ${subject}`,
        timeout,
        intervals: [500, 1000, 2000],
    }).toBeDefined();

    const message = await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json() as { Subject: string; Text: string };
    return { subject: message.Subject, text: message.Text };
}

/** The first link in the mail that leads to [path] in the shop. */
export function linkTo(mail: Mail, path: string): string {
    const link = mail.text.match(/https?:\/\/\S+/g)?.find(url => new URL(url).pathname === path);
    if (!link)
        throw new Error(`No link to ${path} in "${mail.subject}":\n${mail.text}`);
    return link;
}
