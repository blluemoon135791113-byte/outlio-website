# Security controls

Last reviewed: 2026-08-09

## Source-code boundaries

- The GitHub repository must remain private. Access is limited through GitHub collaborators and installed deployment integrations.
- Browser-delivered HTML, CSS, and JavaScript are always inspectable by visitors. No secret or privileged business logic may be placed in a Client Component.
- Privileged Supabase access lives behind `server-only` modules. `SUPABASE_SERVICE_ROLE_KEY` and `TRIAL_IP_HASH_SECRET` must never use the `NEXT_PUBLIC_` prefix.
- Production browser source maps are disabled. Source maps are a debugging aid, not an authorization boundary.
- Database RLS remains the primary tenant-isolation boundary. Every service-role query must also scope by the verified user ID.

## Duplicate-account controls

Migration `0018_signup_ip_gate.sql` enforces the signup gate at the database layer:

1. The server canonicalizes the client IP. IPv6 privacy addresses are grouped by `/64`.
2. The network identity is HMAC-SHA256 hashed with `TRIAL_IP_HASH_SECRET`. The raw IP is never stored in the claims table.
3. A service-role-only RPC atomically reserves the hash for ten minutes.
4. Supabase Auth receives a random, one-time reservation token in user metadata.
5. The `auth.users` insert trigger consumes that token in the same transaction. Direct calls to `auth.signUp` without a valid reservation are rolled back.
6. Completed network claims are retained after account deletion so deletion cannot reset trial eligibility.
7. New duplicate phone numbers and LinkedIn profile URLs are rejected by a lock-backed database trigger.

IP controls reduce casual trial abuse but cannot identify a person with certainty. VPNs, mobile carrier networks, schools, offices, and households can create false positives or bypasses. Support should manually review legitimate users on shared networks.

## Deployment requirements

Production requires these secrets in Vercel:

- `SUPABASE_SERVICE_ROLE_KEY`
- `TRIAL_IP_HASH_SECRET` with at least 32 random characters

Keep `TRIAL_IP_HASH_SECRET` stable. Because raw addresses are deliberately not
stored, changing the secret creates a new hash namespace and effectively resets
network-based trial history. Rotate it only as part of an incident response and
assume previous network claims will no longer match.

The Supabase URL and publishable key are public by design. Their safety depends on RLS, restricted RPC grants, and the database signup trigger.
