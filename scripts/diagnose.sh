#!/usr/bin/env bash
# Writes what is needed to understand a failed run into a folder (uploaded by the workflow):
# Flux state, pods, events, and the logs and descriptions of every pod that is not ready.
# Usage: scripts/diagnose.sh <output dir>
set -uo pipefail

out=${1:?usage: diagnose.sh <output dir>}
context=k3d-nothingeats-ci
mkdir -p "$out/pods"
kube() { kubectl --context "$context" "$@"; }

flux get all -A --context="$context" > "$out/flux.txt" 2>&1
kube get pods -A -o wide > "$out/pods.txt" 2>&1
kube get events -A --sort-by=.lastTimestamp > "$out/events.txt" 2>&1
kube describe nodes > "$out/nodes.txt" 2>&1

# Every pod of the shop gets its logs; the ones that are not ready also a description.
kube get pods -n nothingeats -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' |
    while read -r pod; do
        kube -n nothingeats logs "$pod" --all-containers --tail=500 > "$out/pods/$pod.log" 2>&1
        kube -n nothingeats logs "$pod" --all-containers --previous --tail=200 > "$out/pods/$pod.previous.log" 2>/dev/null ||
            rm -f "$out/pods/$pod.previous.log"
    done
kube get pods -A --field-selector=status.phase!=Succeeded \
    -o jsonpath='{range .items[*]}{.metadata.namespace}{" "}{.metadata.name}{" "}{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{"\n"}{end}' |
    while read -r namespace pod ready; do
        [[ "$ready" == True ]] && continue
        kube -n "$namespace" describe pod "$pod" > "$out/pods/$namespace.$pod.describe.txt" 2>&1
        kube -n "$namespace" logs "$pod" --all-containers --tail=300 > "$out/pods/$namespace.$pod.log" 2>&1
    done

echo "== not ready"
flux get all -A --context="$context" --status-selector ready=false 2>&1 | head -40
kube get pods -A 2>&1 | grep -vE 'Running|Completed' | head -40
