#!/usr/bin/env bash
# Builds the throwaway CI cluster from one commit of nothingeats-gitops and waits until the shop
# is ready to test: k3d -> Flux (installed, not bootstrapped: it reads the repo and never writes)
# -> throwaway secrets -> clusters/ci -> content from the backoffice's seed in catalog and search.
#
# Usage: scripts/cluster-up.sh <nothingeats-gitops checkout>
# Needs 80 free on 127.0.0.1 (stop the local cluster first on a laptop: k3d cluster stop nothingeats).
set -euo pipefail
cd "$(dirname "$0")/.."

gitops=${1:?usage: cluster-up.sh <nothingeats-gitops checkout>}
context=k3d-nothingeats-ci
commit=$(git -C "$gitops" rev-parse HEAD)
base_url=${BASE_URL:-http://nothingeats.localhost}
timeout=${CLUSTER_TIMEOUT:-1800}
deadline=$((SECONDS + timeout))

# Polls a command until it succeeds; prints the Flux state once a minute while it waits.
wait_for() {
    local what=$1
    shift
    local next_report=$((SECONDS + 60))
    until "$@" >/dev/null 2>&1; do
        if ((SECONDS > deadline)); then
            echo "::error::Timed out after $((timeout / 60)) minutes waiting for $what"
            flux get all -A --context="$context" --status-selector ready=false || true
            return 1
        fi
        if ((SECONDS > next_report)); then
            echo "-- still waiting for $what ($((SECONDS / 60)) min)"
            flux get kustomizations --context="$context" || true
            next_report=$((SECONDS + 60))
        fi
        sleep 10
    done
    echo "ready: $what ($SECONDS s)"
}

apps_ready() {
    [[ "$(kubectl --context "$context" -n flux-system get kustomization apps \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == True ]]
}

# The backoffice seeds itself on start; its outbox carries the content to catalog and search.
catalog_filled() {
    [[ "$(curl --silent --fail "$base_url/api/catalog/v1/restaurants?limit=50" | grep -o '"slug"' | wc -l)" -ge 8 ]]
}
search_filled() {
    curl --silent --fail "$base_url/api/search/v1/dishes?q=pizza" | grep -q '"id"'
}

echo "== cluster"
k3d cluster create --config k3d/ci.yaml --wait

echo "== flux"
flux install --context="$context"
# Dependents notice a ready dependency after 5 s instead of 30 s, as in clusters/local.
kubectl --context "$context" -n flux-system patch deployment kustomize-controller --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--requeue-dependency=5s"}]'

echo "== secrets"
"$gitops/clusters/ci/secrets.sh" "$context"

echo "== sync nothingeats-gitops@$commit"
flux create source git flux-system --context="$context" \
    --url=https://github.com/slashncode/nothingeats-gitops --commit="$commit" --interval=1h
flux create kustomization flux-system --context="$context" \
    --source=GitRepository/flux-system --path=./clusters/ci --prune=true --interval=1h --wait=false

wait_for "every app" apps_ready
wait_for "the catalog" catalog_filled
wait_for "the search index" search_filled
flux get helmreleases -A --context="$context"
