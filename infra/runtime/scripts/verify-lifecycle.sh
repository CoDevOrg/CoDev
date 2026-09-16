#!/usr/bin/env bash
set -euo pipefail

# Run this on a provisioned Linux/KVM Firecracker host. It intentionally uses
# the local orchestrator so the test covers the real jailer, guestd, snapshot,
# restore, and destroy path without involving the Vercel control plane.
: "${CODEV_ORCHESTRATOR_URL:=http://127.0.0.1:8080}"
: "${CODEV_MAX_RESTORE_MS:=500}"
: "${CODEV_SMOKE_WORKSPACE_ID:=e010bd2c-a3c1-438f-acef-166287a3b1cb}"
: "${CODEV_EC2_INSTANCE_ID:=}"
: "${CODEV_EC2_STOP_TIMEOUT_SECONDS:=1200}"

readonly work_dir="$(mktemp -d)"
cleanup() {
  curl --silent --output /dev/null --request DELETE \
    "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}" || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT

readonly base_sha="fc1ba2947ffdaf8c1961e5342387e1079afface6"
readonly expires_at="$(date -u -d '+1 hour' --iso-8601=seconds)"
readonly content_before=$'# CoDev lifecycle smoke test\n'
readonly content_after=$'# CoDev lifecycle smoke test\nrestored=true\n'
readonly agent_worktree_id="agent-smoke"
readonly agent_content=$'# Agent context must survive hibernation\n'
readonly content_base64="$(printf '%b' "${content_before}" | base64 -w0)"
readonly content_bytes="$(printf '%b' "${content_before}" | wc -c | tr -d ' ')"

request() {
  curl --fail-with-body --silent --show-error \
    --header 'content-type: application/json' \
    "$@"
}

verify_ec2_stopped() {
  if [[ -z "${CODEV_EC2_INSTANCE_ID}" ]]; then
    return
  fi
  command -v aws >/dev/null || {
    echo "aws CLI is required when CODEV_EC2_INSTANCE_ID is set" >&2
    exit 1
  }
  local deadline=$(( $(date +%s) + CODEV_EC2_STOP_TIMEOUT_SECONDS ))
  local state
  while (( $(date +%s) < deadline )); do
    state="$(aws ec2 describe-instances \
      --instance-ids "${CODEV_EC2_INSTANCE_ID}" \
      --query 'Reservations[0].Instances[0].State.Name' \
      --output text)"
    if [[ "${state}" == "stopped" ]]; then
      echo "EC2 host ${CODEV_EC2_INSTANCE_ID} reached stopped state."
      return
    fi
    sleep 5
  done
  echo "EC2 host ${CODEV_EC2_INSTANCE_ID} did not reach stopped state within ${CODEV_EC2_STOP_TIMEOUT_SECONDS}s (last state: ${state:-unknown})." >&2
  exit 1
}

create_payload() {
  local resume_from_snapshot="$1"
  jq -cn \
    --arg workspace_id "${CODEV_SMOKE_WORKSPACE_ID}" \
    --arg base_sha "${base_sha}" \
    --arg expires_at "${expires_at}" \
    --arg content_base64 "${content_base64}" \
    --argjson content_bytes "${content_bytes}" \
    --argjson resume_from_snapshot "${resume_from_snapshot}" \
    '{
      workspaceId: $workspace_id,
      repositoryUrl: null,
      repositorySnapshot: {
        files: [{ path: "README.md", mode: "100644", contentBase64: $content_base64 }],
        totalBytes: $content_bytes
      },
      baseSha: $base_sha,
      expiresAt: $expires_at,
      resumeFromSnapshot: $resume_from_snapshot,
      lifecycle: {
        timeoutMs: 14400000,
        lifecycle: { onTimeout: "pause", autoResume: true }
      }
    }'
}

echo "Checking orchestrator health"
health="$(curl --fail-with-body --silent --show-error "${CODEV_ORCHESTRATOR_URL}/healthz")"
[[ "$(jq -r '.status' <<<"${health}")" == "ok" ]]
[[ "$(jq -r '.activeSandboxes' <<<"${health}")" == "0" ]]

echo "Creating a real Firecracker workspace"
created="$(request \
  --request POST \
  --data "$(create_payload false)" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes")"
head_sha="$(jq -r '.sandbox.headSha' <<<"${created}")"
[[ "${head_sha}" =~ ^[0-9a-f]{40}$ ]]

file="$(request \
  --request POST \
  --data '{"path":"README.md"}' \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/read")"
revision="$(jq -r '.file.revision' <<<"${file}")"
[[ -n "${revision}" && "${revision}" != "null" ]]

request \
  --request POST \
  --data "$(jq -cn \
    --arg contents "${content_after}" \
    --arg revision "${revision}" \
    '{path:"README.md", contents:$contents, expectedRevision:$revision}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/write" >/dev/null

request \
  --request POST \
  --data "$(jq -cn \
    --arg worktree_id "${agent_worktree_id}" \
    --arg head_sha "${head_sha}" \
    '{worktreeId:$worktree_id, headSha:$head_sha}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/worktrees" >/dev/null

agent_file="$(request \
  --request POST \
  --data "$(jq -cn --arg worktree_id "${agent_worktree_id}" \
    '{path:"README.md", worktreeId:$worktree_id}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/read")"
agent_revision="$(jq -r '.file.revision' <<<"${agent_file}")"
[[ -n "${agent_revision}" && "${agent_revision}" != "null" ]]
request \
  --request POST \
  --data "$(jq -cn \
    --arg worktree_id "${agent_worktree_id}" \
    --arg contents "${agent_content}" \
    --arg revision "missing" \
    '{path:"agent-context.txt", worktreeId:$worktree_id, contents:$contents, expectedRevision:$revision}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/write" >/dev/null

terminal="$(request \
  --request POST \
  --data '{"rows":24,"columns":80}' \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/terminals")"
terminal_id="$(jq -r '.sessionId' <<<"${terminal}")"
[[ "${terminal_id}" =~ ^term- ]]
request \
  --request POST \
  --data "$(jq -cn --arg data $'printf \'terminal-state-ok\\n\'; sleep 300\n' '{data:$data}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/terminals/${terminal_id}/input" >/dev/null

terminal_before=''
for _ in {1..20}; do
  terminal_before="$(request \
    --request POST \
    --data '{"after":0}' \
    "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/terminals/${terminal_id}/poll")"
  if jq -e '([.result.chunks[]?.data] | join("")) | contains("terminal-state-ok")' \
    <<<"${terminal_before}" >/dev/null; then
    break
  fi
  sleep 0.1
done
jq -e '([.result.chunks[]?.data] | join("")) | contains("terminal-state-ok")' \
  <<<"${terminal_before}" >/dev/null

echo "Pausing and snapshotting the VM"
snapshot_started="$(date +%s%3N)"
request \
  --request POST \
  --data "$(jq -cn --arg head_sha "${head_sha}" '{expectedHeadSha:$head_sha}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/snapshot" >/dev/null
snapshot_finished="$(date +%s%3N)"

request \
  --request DELETE \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}" >/dev/null

status_code="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}")"
if [[ "${status_code}" != "404" ]]; then
  echo "sandbox still exists after destroy" >&2
  exit 1
fi

health="$(curl --fail-with-body --silent --show-error "${CODEV_ORCHESTRATOR_URL}/healthz")"
[[ "$(jq -r '.activeSandboxes' <<<"${health}")" == "0" ]]

echo "Restoring the VM from its Firecracker snapshot"
restore_started="$(date +%s%3N)"
restored="$(request \
  --request POST \
  --data "$(create_payload true)" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes")"
restore_finished="$(date +%s%3N)"
restore_ms=$((restore_finished - restore_started))
if (( restore_ms > CODEV_MAX_RESTORE_MS )); then
  echo "snapshot restore took ${restore_ms}ms; target is ${CODEV_MAX_RESTORE_MS}ms" >&2
  exit 1
fi

restored_file="$(request \
  --request POST \
  --data '{"path":"README.md"}' \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/read")"
jq -e --arg expected "${content_after}" '.file.contents == $expected' <<<"${restored_file}" >/dev/null

restored_agent_file="$(request \
  --request POST \
  --data "$(jq -cn --arg worktree_id "${agent_worktree_id}" \
    '{path:"agent-context.txt", worktreeId:$worktree_id}')" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/files/read")"
jq -e --arg expected "${agent_content}" '.file.contents == $expected' \
  <<<"${restored_agent_file}" >/dev/null

terminal_after="$(request \
  --request POST \
  --data '{"after":0}' \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/terminals/${terminal_id}/poll")"
jq -e '([.result.chunks[]?.data] | join("")) | contains("terminal-state-ok")' \
  <<<"${terminal_after}" >/dev/null
request \
  --request DELETE \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/terminals/${terminal_id}" >/dev/null

request \
  --request DELETE \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}/worktrees/${agent_worktree_id}" >/dev/null

request \
  --request DELETE \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}" >/dev/null

verify_ec2_stopped

snapshot_ms=$((snapshot_finished - snapshot_started))
cat <<EOF
Lifecycle smoke test passed.
  snapshot_ms=${snapshot_ms}
  restore_ms=${restore_ms}
  active_sandboxes_after_destroy=$(jq -r '.activeSandboxes' <<<"$(curl --fail-with-body --silent --show-error "${CODEV_ORCHESTRATOR_URL}/healthz")")

The host's asynchronous power-off is governed by CODEV_HOST_IDLE_TIMEOUT.
Set CODEV_EC2_INSTANCE_ID to make this script verify the EC2 stop state, or run:
  aws ec2 describe-instances --instance-ids INSTANCE_ID --query 'Reservations[0].Instances[0].State.Name' --output text
EOF
