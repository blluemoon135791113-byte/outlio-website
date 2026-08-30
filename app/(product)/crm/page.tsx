import { redirect } from 'next/navigation'

/**
 * `/crm` has no landing surface of its own yet — the overview arrives with
 * reporting in M4. Until then it sends people to the one thing that exists,
 * rather than rendering an empty page that says nothing.
 */
export default function CrmIndexPage() {
  redirect('/crm/pipeline')
}
