#!/usr/bin/env bash
set -euo pipefail

# Run on an otherwise idle Linux/KVM host after deploying the runtime.
# This uses the same durable workspace and Superset worktree paths as Gen 2.
: "${CODEV_ORCHESTRATOR_URL:=http://127.0.0.1:8080}"
: "${CODEV_SMOKE_WORKSPACE_ID:=$(cat /proc/sys/kernel/random/uuid)}"
: "${CODEV_VERIFY_SERVICE_RESTART:=0}"
: "${CODEV_MAX_RESTORE_MS:=60000}"
readonly worktree_id="persistence-smoke"
readonly branch="codev/persistence-smoke"
readonly contents=$'Uncommitted worktree content must survive stop and restart.\n'
readonly sandbox_url="${CODEV_ORCHESTRATOR_URL}/v1/sandboxes/${CODEV_SMOKE_WORKSPACE_ID}"

request() {
  local headers=()
  if [[ -n "${CODEV_DIRECT_SECRET:-}" ]]; then
    headers+=(--header "Authorization: Bearer ${CODEV_DIRECT_SECRET}")
  fi
  curl --fail-with-body --silent --show-error --max-time 180 \
    --header 'content-type: application/json' "${headers[@]}" "$@"
}
cleanup() {
  request --request DELETE "${sandbox_url}" >/dev/null 2>&1 || true
  request --request DELETE "${sandbox_url}/snapshot" >/dev/null 2>&1 || true
}
create_payload() {
  jq -cn --arg id "${CODEV_SMOKE_WORKSPACE_ID}" \
    --arg expires "$(date -u -d '+4 hours' --iso-8601=seconds)" \
    --argjson require_saved "$1" \
    '{workspaceId:$id, repositoryUrl:null,
      repositorySnapshot:{files:[{path:"README.md",mode:"100644",contentBase64:"dGVzdAo="}],totalBytes:5},
      baseSha:"0000000000000000000000000000000000000000",
      expiresAt:$expires, resumeFromSnapshot:true, requireSavedState:$require_saved,
      hibernateOnIdle:true,
      lifecycle:{timeoutMs:14400000,lifecycle:{onTimeout:"pause",autoResume:true}}}'
}
verify_worktree() {
  local trees file
  trees="$(request "${sandbox_url}/superset/runtime/worktrees")"
  jq -e --arg id "${worktree_id}" --arg branch "${branch}" \
    '.worktrees | any(.worktreeId == $id and .branch == $branch)' <<<"${trees}" >/dev/null
  file="$(request --request POST \
    --data "$(jq -cn --arg id "${worktree_id}" '{worktreeId:$id,path:"untracked.txt"}')" \
    "${sandbox_url}/files/read")"
  jq -e --arg expected "${contents}" '.file.contents == $expected' <<<"${file}" >/dev/null
}

health="$(request "${CODEV_ORCHESTRATOR_URL}/healthz")"
jq -e '.status == "ok" and .activeSandboxes == 0' <<<"${health}" >/dev/null || {
  echo 'Refusing lifecycle verification while another workspace is running.' >&2
  exit 1
}
trap cleanup EXIT
request --request POST --data "$(create_payload false)" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes" >/dev/null
request --request POST \
  --data "$(jq -cn --arg id "${worktree_id}" --arg branch "${branch}" '{worktreeId:$id,branch:$branch}')" \
  "${sandbox_url}/superset/runtime/worktrees" >/dev/null
request --request POST \
  --data "$(jq -cn --arg id "${worktree_id}" --arg contents "${contents}" \
    '{worktreeId:$id,path:"untracked.txt",contents:$contents,expectedRevision:"missing"}')" \
  "${sandbox_url}/files/write" >/dev/null
verify_worktree

echo 'Stopping without an explicit snapshot, then reopening'
request --request DELETE "${sandbox_url}" >/dev/null
started="$(date +%s%3N)"
request --request POST --data "$(create_payload true)" \
  "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes" >/dev/null
restore_ms=$(( $(date +%s%3N) - started ))
(( restore_ms <= CODEV_MAX_RESTORE_MS ))
verify_worktree

if [[ "${CODEV_VERIFY_SERVICE_RESTART}" == "1" ]]; then
  # Opt-in only: this restarts the host service and requires root privileges.
  # Write newer data AFTER the checkpoint so a stale restore cannot pass.
  contents_after=$'Newer data written after resume must survive service restart.\n'
  file="$(request --request POST \
    --data "$(jq -cn --arg id "${worktree_id}" '{worktreeId:$id,path:"untracked.txt"}')" \
    "${sandbox_url}/files/read")"
  revision="$(jq -r '.file.revision' <<<"${file}")"
  request --request POST \
    --data "$(jq -cn --arg id "${worktree_id}" --arg contents "${contents_after}" --arg revision "${revision}" \
      '{worktreeId:$id,path:"untracked.txt",contents:$contents,expectedRevision:$revision}')" \
    "${sandbox_url}/files/write" >/dev/null
  systemctl restart codev-orchestrator.service
  request --request POST --data "$(create_payload true)" \
    "${CODEV_ORCHESTRATOR_URL}/v1/sandboxes" >/dev/null
  trees="$(request "${sandbox_url}/superset/runtime/worktrees")"
  jq -e --arg id "${worktree_id}" '.worktrees | any(.worktreeId == $id)' <<<"${trees}" >/dev/null
  file="$(request --request POST \
    --data "$(jq -cn --arg id "${worktree_id}" '{worktreeId:$id,path:"untracked.txt"}')" \
    "${sandbox_url}/files/read")"
  jq -e --arg expected "${contents_after}" '.file.contents == $expected' <<<"${file}" >/dev/null
fi

echo "Lifecycle persistence verification passed (restore ${restore_ms}ms)."
