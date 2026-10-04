#!/usr/bin/env bash
set -euo pipefail

# The loopback RPC can launch privileged processes. Only root and the Azure
# administrator (uid 1000) may call it; terminals use 2000 and agents higher uids.
iptables -w 5 -N CODEV_LOCAL_API 2>/dev/null || true
iptables-restore --noflush -w 5 <<'RULES'
*filter
-F CODEV_LOCAL_API
-A CODEV_LOCAL_API -m owner --uid-owner 0 -j RETURN
-A CODEV_LOCAL_API -m owner --uid-owner 1000 -j RETURN
-A CODEV_LOCAL_API -p tcp -j REJECT --reject-with tcp-reset
COMMIT
RULES
if ! iptables -w 5 -C OUTPUT -o lo -d 127.0.0.1 -p tcp --dport 5252 -j CODEV_LOCAL_API 2>/dev/null; then
  iptables -w 5 -I OUTPUT 1 -o lo -d 127.0.0.1 -p tcp --dport 5252 -j CODEV_LOCAL_API
fi
