# Outlio application security review

Date: 9 August 2026
Scope: the Next.js application, Supabase schema/policies/functions and the hosted Supabase authentication settings available to this project.

## Result

- **37 of 39 controls complete**
- **2 of 39 controls partially complete with compensating controls**
- **0 controls unimplemented**

This is a point-in-time engineering review, not a guarantee that a system can never be compromised. The two partial items require a provider setting or plan change; neither is left without a mitigation.

## Control matrix

| # | Control | Status | Evidence or implementation |
|---:|---|---|---|
| 1 | Login and logout | Complete | Supabase password auth, server-validated sessions and explicit sign-out in `lib/auth/actions.ts`. |
| 2 | Strong password policy | Complete | 12–128 characters, weak/common-pattern rejection in `lib/auth/password.ts`; hosted minimum set to 12 and secure password changes enabled. |
| 3 | Multi-factor authentication | Complete | TOTP enrollment, challenge and removal in settings; enrolled users are challenged and administrators require AAL2. |
| 4 | Account recovery and password reset | Complete | One-time recovery flow, safe redirect allow-list and current-password verification for in-session changes. |
| 5 | Role-based access control | Complete | Server-side roles in `profiles`, `requireUser`, `requireAdmin` and database RLS. |
| 6 | User and administrator permissions | Complete | Admin-only server actions plus service-role-only database functions. |
| 7 | Prevent cross-user data access | Complete | Owner-scoped RLS and explicit `user_id` filters wherever the service role bypasses RLS. |
| 8 | Prevent privilege escalation | Complete | Protected profile columns, database trigger enforcement and AAL2 for admin mutations. |
| 9 | Secure session creation and termination | Complete | Server revalidation with `getUser()`, refresh-token replay protection and cookie deletion on sign-out/expiry. |
| 10 | Session timeout | Complete | Signed, HttpOnly application guard: 8-hour idle and 7-day absolute limits in `lib/auth/session-guard.ts`. |
| 11 | Secure cookies | Partial | Production `Secure`, `SameSite=Lax` and scoped paths are explicit. Supabase SSR auth cookies remain browser-readable because its browser client needs refresh/MFA access; CSP, short-lived tokens and the separate HttpOnly guard reduce exposure. |
| 12 | Session hijacking protection | Complete | Token revalidation, refresh reuse detection, signed guard, MFA and immediate cookie clearing on tamper/expiry. |
| 13 | Validate user-supplied data | Complete | Zod and dedicated normalizers at server-action boundaries, including E.164 phone normalization. |
| 14 | Prevent SQL injection, XSS and command injection | Complete | Parameterized Supabase queries/RPCs, no shell construction from user input, React escaping and restrictive CSP. |
| 15 | Proper file upload handling | Complete | Private signed uploads, randomized owner paths, size/type limits, server-side magic-byte validation and service-role-only avatar writes. |
| 16 | Encryption in transit | Complete | Production HTTPS/HSTS and Supabase TLS endpoints. |
| 17 | Encryption at rest | Partial | Database and object storage are hosted by Supabase; application secrets are not stored in source. Provider-managed at-rest encryption is relied upon, but independent KMS/attestation is outside this repository and dashboard plan. |
| 18 | Password and personal-data handling | Complete | Supabase Auth hashes passwords; secrets stay server-side; phone numbers are canonicalized; logs pseudonymize login subjects. |
| 19 | Prevent application-rule bypass | Complete | Entitlements, suspension, access expiry and ownership are rechecked server-side. |
| 20 | Enforce transaction and usage limits | Complete | Atomic database credit consumption, usage counters and database-backed rate limits. |
| 21 | Prevent unauthorized price/quantity/approval changes | Complete | Plans and grants are server/admin controlled; entitlement changes are transactional and audited. |
| 22 | Avoid secrets in errors | Complete | Public actions return generic errors; provider/database details stay server-side. |
| 23 | Exception handling | Complete | Expected failures are handled and security controls fail closed where authorization/rate state cannot be verified. |
| 24 | Safe security-error logging | Complete | Structured security events contain user IDs or HMAC-pseudonymous subjects, never passwords or raw IP addresses. |
| 25 | Record login attempts | Complete | Success, failure and rate-limit events are recorded without raw credentials. |
| 26 | Track important user actions | Complete | Profile, avatar, password, job and account lifecycle actions are recorded. |
| 27 | Log privilege/configuration changes | Complete | Entitlement, role and suspension operations write audit rows in the same transaction as the change. |
| 28 | Maintain audit trails | Complete | Append-only admin/system logs plus Supabase Auth audit events. |
| 29 | CSRF protection | Complete | SameSite cookies, server actions' origin checks and no cross-origin mutation API surface. |
| 30 | XSS protection | Complete | React output encoding, file-type restrictions, no SVG avatars and CSP/security headers. |
| 31 | SQL injection protection | Complete | Parameterized query builder/RPC calls and fixed SQL identifiers. |
| 32 | Clickjacking protection | Complete | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| 33 | Secure file handling | Complete | Private buckets, owner policies, signed short-lived URLs, sanitized display/export names and CSV formula neutralization. |
| 34 | Rate limiting and brute-force protection | Complete | Database-backed HMAC-pseudonymous IP/email/user limits fail closed; hosted refresh replay protection is enabled. CAPTCHA can be added later as defense in depth when provider keys are supplied. |
| 35 | API authentication and authorization | Complete | The callback is the only public route handler; mutations are authenticated server actions with ownership/role checks. |
| 36 | API input validation | Complete | Schemas, UUID validation, length limits and canonicalization precede database/storage work. |
| 37 | API rate limiting | Complete | Auth, uploads, exports, purge and settings mutations use database-backed limits. |
| 38 | API error handling | Complete | Stable user-safe action states; no stack traces, SQL details or service keys in responses. |
| 39 | Prevent unauthorized API data access | Complete | RLS plus verified-user scoping on all service-role reads/writes. |

## Hosted-platform follow-ups

1. Enable Supabase leaked-password screening after upgrading to a plan that exposes the setting. The current 12-character policy and application deny-list remain active meanwhile.
2. Connect Turnstile or hCaptcha keys if automated sign-up abuse becomes measurable. Existing database-backed identity, device, IP and attempt limits remain authoritative.
3. If a compliance framework requires customer-managed encryption keys or a formal at-rest attestation, obtain it from the infrastructure provider or move to the required plan.

## Security Advisor disposition

The migration set revokes default public function execution, pins function search paths, keeps trigger/internal RPCs service-only and moves `pg_trgm` out of `public`. The remaining `is_admin()` authenticated execution is deliberate: RLS policies call it, it evaluates only the current authenticated identity and returns a boolean. Leaked-password screening is the provider-plan limitation noted above.
