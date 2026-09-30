#!/usr/bin/env bash
set -euo pipefail

readonly deployment_url="${1:?usage: scripts/verify-deployment.sh https://deployment-url}"
readonly health_url="${deployment_url%/}/api/health"
readonly ready_url="${deployment_url%/}/api/ready"

health="$(curl -fsS --max-time 20 "${health_url}")"
jq -e '.status == "ok" and .service == "codev-web"' <<<"${health}" >/dev/null

ready="$(curl -fsS --max-time 45 "${ready_url}")"
jq -e '
  .status == "ready"
  and .components.database.status == "ready"
  and .components.realtime.status == "ready"
  and (
    .components.orchestrator.status == "ready"
    or .components.orchestrator.status == "sleeping"
    or .components.orchestrator.status == "starting"
  )
' <<<"${ready}" >/dev/null

echo "CoDev deployment is live and ready: ${deployment_url}"
