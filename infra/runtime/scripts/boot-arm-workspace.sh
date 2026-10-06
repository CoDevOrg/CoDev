#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || exit 1
# Never fetch software or secrets at workspace boot. The saved disk is verified
# before local services can expose workspace RPC through the connector.
python3 - <<'PYBOOT'
import json, os, subprocess
with open("/etc/codev/arm-boot.json") as source:
    config = json.load(source)
os.environ["CODEV_DISK_MODE"] = config["diskMode"]
os.environ["CODEV_DISK_EXPECTED_UUID"] = config["diskUuid"]
subprocess.run(["/bin/bash", "/usr/local/sbin/codev-prepare-arm-disk"], check=True)
# Once formatted, every OS reboot must use the strict saved-disk path.
config["diskMode"] = "existing"
with open("/etc/codev/arm-boot.json", "w") as out:
    json.dump(config, out)
PYBOOT
