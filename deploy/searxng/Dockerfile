# SearXNG for Outlio, behind an authenticating front door.
#
# ⚠️ TWO PROCESSES ON PURPOSE. SearXNG binds to loopback only; Caddy is the
# sole publicly bound listener and rejects anything without the bearer token.
# Exposing SearXNG directly would publish an open search proxy.
FROM searxng/searxng:latest

USER root
RUN apk add --no-cache caddy

COPY settings.yml /etc/searxng/settings.yml
COPY limiter.toml /etc/searxng/limiter.toml
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV INSTANCE_NAME=outlio-search
EXPOSE 8080

ENTRYPOINT ["/start.sh"]
