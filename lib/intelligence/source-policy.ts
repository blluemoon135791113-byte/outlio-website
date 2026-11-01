/**
 * Sources a contact is never taken from.
 *
 * PURE.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ PEOPLE-SEARCH SITES ARE NOT BUSINESS SOURCES.                        ║
 * ║                                                                          ║
 * ║  Spokeo, Whitepages and their kind compile PRIVATE individuals' home     ║
 * ║  addresses, personal mobiles and relatives from public records and data  ║
 * ║  brokers. A number from one is a consumer record, not a business         ║
 * ║  contact a person chose to publish — the GDPR Art. 14 exposure the owner ║
 * ║  accepted for business data does not stretch to it, and the values are  ║
 * ║  often stale. Measured 2026-10-31: one stored person contact came from   ║
 * ║  spokeo.com. Blocked by owner decision on 2026-11-01.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Contact-data directories (ContactOut, ZoomInfo, RocketReach) are NOT here:
 * they index professional profiles, and the owner treats what their public
 * pages show as valid public data.
 */

/** Registrable domains of consumer people-search and reverse-lookup sites. */
export const PEOPLE_SEARCH_DOMAINS: ReadonlySet<string> = new Set([
  'spokeo.com', 'whitepages.com', 'beenverified.com', 'truepeoplesearch.com',
  'fastpeoplesearch.com', 'peoplefinders.com', 'intelius.com', 'instantcheckmate.com',
  'truthfinder.com', 'radaris.com', 'mylife.com', 'peekyou.com', 'thatsthem.com',
  'zabasearch.com', 'ussearch.com', 'peoplelooker.com', 'searchpeoplefree.com',
  'clustrmaps.com', 'nuwber.com', 'addresses.com', '411.com', 'anywho.com',
  'publicrecordsnow.com', 'familytreenow.com', 'cocofinder.com', 'voterrecords.com',
  'usphonebook.com', 'sync.me', 'truecaller.com', '192.com', 'spydialer.com',
  'peoplesearchnow.com', 'idcrawl.com', 'checkpeople.com', 'neighbor.report',
  'advancedbackgroundchecks.com', 'smartbackgroundchecks.com', 'publicdatausa.com',
  'officialusa.com', 'locatefamily.com', 'infotracer.com', 'peoplefinder.com',
])

/** True when `hostOrUrl` is, or is under, a people-search site. */
export function isPeopleSearchSource(hostOrUrl: string | null | undefined): boolean {
  if (!hostOrUrl) return false
  let host = hostOrUrl.toLowerCase()
  try {
    if (host.includes('/')) host = new URL(host).hostname.toLowerCase()
  } catch {
    return false
  }
  host = host.replace(/^www\./, '')
  const labels = host.split('.')
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (PEOPLE_SEARCH_DOMAINS.has(labels.slice(i).join('.'))) return true
  }
  return false
}

/**
 * Email-pattern and email-finder sites.
 *
 * ⚠️ NOT A SOURCE FOR THE RESEARCH AGENT, AND ONLY FOR IT. Their pages state
 * an "email format" or a guessed, masked address — a pattern applied to a
 * name is the fabrication CLAUDE.md rule 4 forbids. Measured 2026-11-01: the
 * agent's first live run opened LeadIQ "email-format" pages for two leads, and
 * a masked `*******@` address on a finder's profile page for another.
 *
 * Profile directories (ContactOut, ZoomInfo, RocketReach) stay readable, per
 * the owner decision above; the deterministic providers are unchanged.
 */
export const CONTACT_DATA_VENDOR_DOMAINS: ReadonlySet<string> = new Set([
  'leadiq.com', 'hunter.io', 'snov.io', 'voilanorbert.com', 'findymail.com', 'anymailfinder.com',
  'skrapp.io', 'emailformat.com', 'email-format.com', 'getemail.io', 'muraena.ai', 'prospeo.io',
  'getprospect.com', 'nymeria.io',
])

/** True when `hostOrUrl` is, or is under, a contact-data vendor's site. */
export function isContactDataVendor(hostOrUrl: string | null | undefined): boolean {
  if (!hostOrUrl) return false
  let host = hostOrUrl.toLowerCase()
  try {
    if (host.includes('/')) host = new URL(host).hostname.toLowerCase()
  } catch {
    return false
  }
  const labels = host.replace(/^www\./, '').split('.')
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (CONTACT_DATA_VENDOR_DOMAINS.has(labels.slice(i).join('.'))) return true
  }
  return false
}
