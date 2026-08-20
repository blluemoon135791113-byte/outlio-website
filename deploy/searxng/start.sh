#!/bin/sh
set -e

# ⚠️ REFUSE TO START WITHOUT A TOKEN. Defaulting to empty would make the
# Authorization matcher trivially satisfiable and silently publish an open
# proxy — the exact failure this container exists to prevent.
if [ -z "${SEARXNG_AUTH_TOKEN:-}" ]; then
  echo "FATAL: SEARXNG_AUTH_TOKEN is not set. Refusing to start an unauthenticated instance." >&2
  exit 1
fi

if [ -z "${SEARXNG_SECRET:-}" ]; then
  echo "FATAL: SEARXNG_SECRET is not set." >&2
  exit 1
fi

# SearXNG listens only on loopback; Caddy is the only thing bound publicly.
sed -i "s|PLACEHOLDER_REPLACED_BY_ENV|${SEARXNG_SECRET}|" /etc/searxng/settings.yml

export SEARXNG_BIND_ADDRESS=127.0.0.1
export SEARXNG_PORT=8888

/usr/local/searxng/dockerfiles/docker-entrypoint.sh &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
