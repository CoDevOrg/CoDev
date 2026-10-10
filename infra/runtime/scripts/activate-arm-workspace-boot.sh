#!/usr/bin/env bash
# Identity is delivered only through Azure protected extension settings.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || exit 1
umask 077
python3 -c '
import json, os, sys, uuid
data = json.load(sys.stdin)
assert set(data) == {"workspaceId", "generation", "audience", "diskUuid", "verificationKey", "tunnelToken", "diskMode"}
assert data["diskMode"] in ("new", "existing")
uuid.UUID(data["workspaceId"])
uuid.UUID(data["diskUuid"])
assert isinstance(data["generation"], int) and data["generation"] > 0
assert isinstance(data["tunnelToken"], str) and data["tunnelToken"] and "\n" not in data["tunnelToken"]
os.makedirs("/etc/codev", mode=0o700, exist_ok=True)
identity = {k: v for k, v in data.items() if k not in ("tunnelToken", "diskMode")}
for path, value in [("arm-runtime.json", json.dumps(identity)), ("tunnel-token", data["tunnelToken"]), ("arm-boot.json", json.dumps({"diskMode": data["diskMode"], "diskUuid": data["diskUuid"]}))]:
    fd = os.open("/etc/codev/" + path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(value)
    os.chmod("/etc/codev/" + path, 0o600)
# The unprivileged preview proxy reads only this public identity. umask 077
# masks the modes passed to makedirs and open, so set them explicitly.
preview = {"workspaceId": data["workspaceId"], "generation": data["generation"], "verificationPublicKey": data["verificationKey"]}
os.makedirs("/etc/codev-preview", mode=0o755, exist_ok=True)
os.chmod("/etc/codev-preview", 0o755)
fd = os.open("/etc/codev-preview/identity.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
with os.fdopen(fd, "w") as out:
    out.write(json.dumps(preview))
os.chmod("/etc/codev-preview/identity.json", 0o644)
'
systemctl start codev-arm-boot.service
