-- 0080 — searchable contact list (CRM UI pass)
--
-- A6 forbids unbounded lists: "pagination/cursors, server filtering, indexes,
-- debounced search". The list query filters on the server and pages, but an
-- ILIKE across names is a sequential scan without an index — fine at a hundred
-- contacts, and the reason a CRM feels broken at fifty thousand.
--
-- Trigram GIN rather than full-text, deliberately. Names are not prose: a
-- tsvector tokenises "Sam" and "Samuel" as unrelated lexemes and cannot match
-- a partial word at all, so searching "sam" would find neither. Trigrams match
-- substrings and typos, which is what someone typing into a contact search
-- actually wants.
--
-- ⚠️ Partial index, excluding soft-deleted rows, so it stays the same size as
-- the list it serves.

create extension if not exists pg_trgm;

create index if not exists crm_contacts_name_trgm_idx
  on public.crm_contacts using gin (full_name gin_trgm_ops)
  where deleted_at is null;

-- The other thing people paste into a search box is an email address.
create index if not exists crm_contact_emails_address_trgm_idx
  on public.crm_contact_emails using gin (address gin_trgm_ops)
  where deleted_at is null;

comment on index public.crm_contacts_name_trgm_idx is
  'Trigram, not full-text: a tsvector cannot match a partial word, so '
  'searching "sam" would find neither Sam nor Samuel.';
