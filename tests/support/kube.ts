import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** The cluster the chaos tests may break: the CI cluster unless told otherwise. */
const context = process.env.E2E_KUBE_CONTEXT ?? 'k3d-nothingeats-ci';

function kubectl(...args: string[]): string {
    return execFileSync('kubectl', [
        '--context',
        context,
        '-n',
        'nothingeats',
        ...args,
    ], { encoding: 'utf8' });
}

/** The running pods of an app, by the chart's name label (cron job pods never run long). */
export const service = (name: string) => `app.kubernetes.io/name=${name}`;
export const kafkaBroker = 'strimzi.io/cluster=kafka,strimzi.io/broker-role=true';

/**
 * Kills the running pods behind [selector] without a grace period: no drain, no shutdown hooks,
 * like a node that loses power. Kubernetes starts new ones; the test watches what the customer sees.
 */
export function crash(selector: string): string[] {
    const pods = kubectl('get', 'pods', '-l', selector, '--field-selector=status.phase=Running', '-o', 'name')
        .split('\n')
        .filter(Boolean);
    if (pods.length === 0)
        throw new Error(`No running pod matches ${selector}`);
    kubectl('delete', ...pods, '--grace-period=0', '--force', '--wait=false');
    return pods;
}
