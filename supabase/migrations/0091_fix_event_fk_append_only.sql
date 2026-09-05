-- 0091 — fix an append-only conflict introduced by 0090 (M6 Phase 17)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  `ON DELETE SET NULL` IS INCOMPATIBLE WITH AN APPEND-ONLY TABLE.          ║
-- ║                                                                           ║
-- ║  0090 gave `email_events` four FKs declared `on delete set null`. Nulling ║
-- ║  a foreign key is an UPDATE, and the append-only guard rejects UPDATE —   ║
-- ║  so the moment any event referenced a row, that row became PERMANENTLY    ║
-- ║  UNDELETABLE:                                                             ║
-- ║                                                                           ║
-- ║    delete from email_enrollments ...                                      ║
-- ║    ERROR: public.email_events is append-only; UPDATE is not permitted     ║
-- ║                                                                           ║
-- ║  That is not a cosmetic bug. It would have blocked deleting a campaign,   ║
-- ║  removing a contact, and — worst — `crm_erase_contact`, the GDPR erasure  ║
-- ║  path. A right-to-erasure request would have failed with a database error ║
-- ║  nobody could act on.                                                     ║
-- ║                                                                           ║
-- ║  ⚠️ FOUND BY AN INTEGRATION TEST, NOT BY REVIEW. 0090's own smoke test    ║
-- ║  passed: it never deleted a row that an event pointed at.                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- THE FIX matches `crm_activities` (0075), which has been right all along:
-- plain references with the default NO ACTION, so deleting a referenced row is
-- REFUSED outright rather than attempting an impossible update. Deletion of
-- real data goes through soft-delete, or through erasure, which sets
-- `outlio.erasure = 'on'` — the escape hatch the guard already honours.

alter table public.email_events
  drop constraint if exists email_events_message_id_fkey,
  drop constraint if exists email_events_enrollment_id_fkey,
  drop constraint if exists email_events_campaign_id_fkey,
  drop constraint if exists email_events_contact_id_fkey;

/*
 * Re-added with NO ACTION (the default). `workspace_id` deliberately keeps its
 * `on delete cascade` from 0090: the guard's second branch already permits a
 * DELETE whose parent workspace no longer exists, which is exactly the
 * workspace-teardown case.
 */
alter table public.email_events
  add constraint email_events_message_id_fkey
    foreign key (message_id) references public.email_messages(id),
  add constraint email_events_enrollment_id_fkey
    foreign key (enrollment_id) references public.email_enrollments(id),
  add constraint email_events_campaign_id_fkey
    foreign key (campaign_id) references public.email_campaigns(id),
  add constraint email_events_contact_id_fkey
    foreign key (contact_id) references public.crm_contacts(id);

comment on table public.email_events is
  'Append-only. The source of every email metric (M6 criterion 5). '
  'References use NO ACTION deliberately: ON DELETE SET NULL would be an '
  'UPDATE, which the append-only guard rejects, making referenced rows '
  'permanently undeletable. Remove real data by soft-delete or via erasure, '
  'which sets outlio.erasure = on.';
