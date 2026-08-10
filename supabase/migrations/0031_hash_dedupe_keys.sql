-- 0031 — dedupe keys become one-way
--
-- THE PROBLEM
--
-- `purge_job_leads` (0013) deletes lead rows once the user has their CSV, but
-- first copies each dedupe_key into `lead_keys`, which is kept for the life of
-- the account. That table is described in 0013 as "dedupe identity WITHOUT
-- personal data", and the marketing page called it an anonymous fingerprint.
--
-- Neither was true. Three of the four key strategies embedded identifying data
-- in readable form:
--
--   li:lead:<member-urn>          a persistent identifier for one person
--   nt:<name>|<title>|<employer>  readable name and employer
--   nc:<name>|<employer>          readable name and employer
--   rh:<sha256>                   already one-way
--
-- So a user who cleared their data, and was told the personal data was gone,
-- still had their prospects' names and employers in our database indefinitely.
--
-- THE FIX
--
-- lib/leads/dedupe.ts now hashes every strategy. Keys are only ever compared
-- for equality, so nothing is lost. This migration rewrites the keys that
-- already exist so that:
--
--   1. cross-upload duplicate detection keeps working for current users, and
--   2. the plaintext already stored is destroyed rather than merely
--      abandoned going forward.
--
-- Both matter. Shipping the code change alone would leave the old plaintext in
-- place AND break dedupe for everyone with history.
--
-- The arithmetic mirrors `hashedKey()` in lib/leads/dedupe.ts exactly:
--   prefix || ':' || left(sha256(material), 32 hex chars)
--
-- Old keys are distinguishable from new ones without ambiguity:
--   - 'li:lead:%' is only ever the old shape; the new one is 'li:<hex>'
--   - nt/nc materials are joined with '|', and slug() strips everything
--     outside [a-z0-9], so a '|' can only appear in an unconverted key
--   - 'rh:%' is unchanged by the code change and is left alone
--
-- That makes this safe to re-run.

-- ---------------------------------------------------------------------------
-- lead_keys — the table that outlives the lead rows
-- ---------------------------------------------------------------------------

update public.lead_keys
   set dedupe_key = 'li:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 9), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'li:lead:%';

update public.lead_keys
   set dedupe_key = 'nt:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 4), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'nt:%'
   and dedupe_key like '%|%';

update public.lead_keys
   set dedupe_key = 'nc:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 4), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'nc:%'
   and dedupe_key like '%|%';

-- ---------------------------------------------------------------------------
-- extracted_leads — live rows not yet purged
--
-- These carry the same key and are matched against lead_keys on the next run,
-- so they must move in step.
-- ---------------------------------------------------------------------------

update public.extracted_leads
   set dedupe_key = 'li:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 9), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'li:lead:%';

update public.extracted_leads
   set dedupe_key = 'nt:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 4), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'nt:%'
   and dedupe_key like '%|%';

update public.extracted_leads
   set dedupe_key = 'nc:' || substr(
         encode(sha256(convert_to(substr(dedupe_key, 4), 'UTF8')), 'hex'), 1, 32)
 where dedupe_key like 'nc:%'
   and dedupe_key like '%|%';

-- ---------------------------------------------------------------------------
-- Correct the record left by 0013.
-- ---------------------------------------------------------------------------

comment on table public.lead_keys is
  'Duplicate-detection identity, retained for the life of the account after the '
  'lead rows are purged. Keys are one-way hashes and carry no readable personal '
  'data, but they are PSEUDONYMOUS, not anonymous: each one still singles out a '
  'specific person and is personal data under the GDPR. Erase on request.';
