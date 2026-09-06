# SearXNG for Outlio

Free web search for Ask Hubble, replacing metered Tavily calls.

> **You may not need this.** `BraveSearchProvider` gives 2,000 searches a month
> on one API key with nothing to deploy, and the waterfall already prefers
> SearXNG whenever `SEARXNG_URL` is set. Host this when Brave's free tier stops
> being enough — roughly 15-20 Hubble questions a day — not before. A server
> you operate is a real cost even when the software is free.

## Why it is behind an auth proxy

SearXNG has **no authentication of its own**. A public instance is a free
search API for anyone who finds it. The real damage is not bandwidth — abuse
gets the instance's IP blocked by Google and Bing, after which Hubble's
searches return nothing, silently, because a failing search provider returns an
empty list by design.

So Caddy binds the public port and SearXNG binds loopback only. Every request
needs `Authorization: Bearer $SEARXNG_AUTH_TOKEN`. `start.sh` refuses to boot
without a token rather than publish an open proxy.

## Deploy (Fly.io)

Fly is suggested because this needs no disk and ~512MB. Any container host works.

```sh
cd deploy/searxng

# 1. Generate two secrets and keep them.
openssl rand -hex 32   # → SEARXNG_SECRET
openssl rand -hex 32   # → SEARXNG_AUTH_TOKEN

# 2. Create the app (does not deploy yet).
fly launch --no-deploy --name outlio-searxng

# 3. Set the secrets.
fly secrets set SEARXNG_SECRET=<first>  SEARXNG_AUTH_TOKEN=<second>

# 4. Deploy.
fly deploy
```

## Verify

```sh
# Unauthenticated → 404, revealing nothing.
curl -s -o /dev/null -w '%{http_code}\n' https://outlio-searxng.fly.dev/

# Authenticated JSON → results.
curl -s -H "Authorization: Bearer <token>" \
  'https://outlio-searxng.fly.dev/search?q=test&format=json' | head -c 200
```

## Point Outlio at it

```sh
vercel env add SEARXNG_URL production          # https://outlio-searxng.fly.dev
vercel env add SEARXNG_AUTH_TOKEN production   # the token
```

The search waterfall prefers SearXNG over Tavily automatically. No code change.

⚠️ `SEARXNG_URL` without `SEARXNG_AUTH_TOKEN` is treated as NOT CONFIGURED for
any non-loopback host, and Hubble falls through to Tavily. That is deliberate:
see `lib/hubble/providers/search.ts`.
