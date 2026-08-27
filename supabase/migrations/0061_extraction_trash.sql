/*
 * Soft-delete for extractions.
 *
 * Trashing a run hides it from the workspace and parks it in the Trash box;
 * restoring brings it straight back. Nothing is erased on trash — deletion of
 * the underlying data is a separate, explicit, permanent action.
 */

alter table public.extraction_jobs
  add column if not exists trashed_at timestamptz;

comment on column public.extraction_jobs.trashed_at is
  'Soft-delete timestamp. Non-null runs leave the history list and live in the '
  'Trash box until restored (set back to null) or permanently deleted.';
