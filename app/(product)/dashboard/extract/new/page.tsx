import { redirect } from 'next/navigation'

// Upload and run tracking are one page now (2026-10-15). Kept so old links,
// bookmarks and onboarding emails still land in the right place.
export default function NewExtractionPage() {
  redirect('/dashboard/jobs')
}
