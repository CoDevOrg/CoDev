#!/bin/sh
set -eu

if ! command -v container >/dev/null 2>&1; then
  echo "Apple Container is required: https://github.com/apple/container" >&2
  exit 1
fi

container system start

if container list --all --format json | grep -q '"codev-postgres"'; then
  container start codev-postgres
else
  container run \
    --name codev-postgres \
    --detach \
    --publish 5432:5432 \
    --env POSTGRES_DB=codev \
    --env POSTGRES_USER=codev \
    --env POSTGRES_PASSWORD=codev \
    docker.io/library/postgres:17-alpine
fi

echo "PostgreSQL is available at postgresql://codev:codev@127.0.0.1:5432/codev"
