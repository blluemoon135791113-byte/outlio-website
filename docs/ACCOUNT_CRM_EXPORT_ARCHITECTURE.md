# Account List CRM Export Architecture

Status: Accepted — 2026-08-29

## Decision

An Account List is a durable set of company records, not a disguised lead
list. Each `account_list_entries` row references one canonical `companies` row
and may reference one real recommended decision-maker lead captured from the
same LinkedIn row.

The normalized export record contains both scopes:

- Company identity, Sales Navigator URL, public LinkedIn URL, domain, industry,
  employee count, headquarters, company email and company phone.
- Optional decision-maker name, title, public LinkedIn URL, Sales Navigator
  URL, work email and mobile phone.
- Provenance/status fields that distinguish verified or publicly found contact
  data from missing data. No person is synthesized for a company-only row.

CSV, Google Sheets, Google Drive, GoHighLevel, and Clay all load this same
provider-neutral record. Provider adapters only translate the contract; they
do not research, infer, or mutate it.

## Data flow

1. Parse the saved Account List page and retain list provenance plus the
   visible recommended contact.
2. Upsert canonical companies using the existing identity precedence.
3. Persist one tenant-scoped Account List entry per company per extraction.
4. Create or reuse a decision-maker lead only when LinkedIn rendered a person.
5. Complete the import and publish an immediately usable canonical CSV.
6. In a bounded background pass, discover company identity/contact facts from
   free public sources and enrich real decision-maker leads through Hubble.
7. Rebuild the CSV after enrichment. Connected CRM exports always read current
   stored values and therefore do not wait for or repeat research.

The recommended person is also a normal Hubble lead: it appears on the
Intelligence board and in the originating Account List batch. It is presented
as an ordinary single lead without an origin badge. Person evidence and
contacts render under Person research; employer evidence and company contacts
render under Company research. The two scopes share a company link, not a
storage bucket or display section.

## Load and safety boundaries

- Automatic enrichment is capped at 60 companies/people per extraction and
  disables itself when paid providers are enabled.
- Official company pages are fetched with timeouts, response-size limits and a
  small fixed path set. CAPTCHA, login and restricted pages are not bypassed.
- Company inboxes and switchboard numbers remain company fields. They are never
  presented as a decision maker's personal contact.
- Provider record links use the stable Account List entry ID, so repeated CRM
  exports can be reconciled without duplicating source identities.
- All reads and writes are tenant-scoped. RLS grants users read access only;
  worker writes remain service-role operations.

## Operational requirement

Apply migration `0067_account_list_crm_exports.sql` before deploying the worker
or export actions. Existing lead exports remain compatible because new columns
default to lead records and account counts default to zero.
