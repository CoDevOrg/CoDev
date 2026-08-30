#!/bin/bash
# Why: remove the PATH symlink that after-install.sh created, but only if it
# still points into our own install dir — never delete an unrelated
# /usr/bin/codev a user or other package may own. Pre-rename install dirs stay
# listed so upgrading from an older package still cleans up.
set -e

link="/usr/bin/codev"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/CoDev/*|/opt/codev/*|/opt/Orca/*|/opt/orca-ide/*|/opt/orca/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0
