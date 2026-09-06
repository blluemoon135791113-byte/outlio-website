import { sanitizeDisplayFilename } from '@/lib/upload/storage-key'

/** Human-readable label only; storage object keys remain server-generated. */
export function extensionCaptureFilename(
  pageName: string | null,
  pageIdentifier: string | null,
): string {
  const name = pageName?.replace(/\.html?$/i, '').trim() || 'Sales Navigator lead list'
  const page = pageIdentifier?.trim() || '1'
  return sanitizeDisplayFilename(`${name} - Page ${page}.html`)
}
