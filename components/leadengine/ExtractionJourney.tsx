import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './ExtractionJourney.module.css'

const SALES_NAV_PROFILES = [
  { initials: 'NH', name: 'Nia Hart', role: 'VP, Revenue Operations', company: 'Meridian Forge' },
  { initials: 'TB', name: 'Theo Bennett', role: 'Partnerships Director', company: 'LumaGrid' },
  { initials: 'AS', name: 'Amara Singh', role: 'Head of Growth', company: 'Asterlane' },
] as const

const CRM_PROFILES = [
  { initials: 'NH', name: 'Nia Hart', email: 'nia@meridian.example', role: 'VP, RevOps', phone: '+1 415 555 0142', company: 'Meridian Forge', website: 'meridianforge.example', linkedin: '/in/nia-hart', status: 'Verified' },
  { initials: 'TB', name: 'Theo Bennett', email: 'theo@lumagrid.example', role: 'Partnerships', phone: '+44 20 5550 0178', company: 'LumaGrid', website: 'lumagrid.example', linkedin: '/in/theo-bennett', status: 'Verified' },
  { initials: 'AS', name: 'Amara Singh', email: 'amara@asterlane.example', role: 'Head of Growth', phone: '+65 6555 0124', company: 'Asterlane', website: 'asterlane.example', linkedin: '/in/amara-singh', status: 'Enriched' },
] as const

function OutlioMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`${styles.outlioMark} ${small ? styles.outlioMarkSmall : ''}`} aria-hidden="true">
      <span />
    </span>
  )
}

function CrmMark() {
  return (
    <span className={styles.crmBrandMark} aria-hidden="true">
      <span className={styles.crmBrandOrbit}><i /><i /><i /></span>
      <span className={styles.crmBrandCore}><i /><i /><i /></span>
    </span>
  )
}

function FeatureGlyph() {
  return (
    <span className={styles.featureGlyph} aria-hidden="true">
      <svg viewBox="0 0 128 128" role="presentation">
        <defs>
          <filter id="extraction-glyph-shadow" x="-35%" y="-30%" width="180%" height="190%">
            <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#8f5a13" floodOpacity=".22" />
          </filter>
        </defs>
        <g className={styles.glyphDepth} transform="translate(0 2)" filter="url(#extraction-glyph-shadow)">
          <path d="M64 48V11A37 37 0 0 0 31.6 30.1Z" fill="#e7b0c0" />
          <path d="M64 48 31.6 30.1A37 37 0 0 0 28.7 72.6Z" fill="#efb662" />
          <path d="M64 48 28.7 72.6A61 61 0 0 0 100.5 105Z" fill="#a7d3d0" />
          <path d="M64 48 88.3 24.9A33.5 33.5 0 0 0 64 14.5Z" fill="#bfd99b" />
          <path d="M64 48 88.3 24.9A33.5 33.5 0 0 1 91.9 72.8Z" fill="#e88a91" />
        </g>
        <g className={styles.glyphLines}>
          <path d="M64 48V11M64 48 31.6 30.1M64 48 28.7 72.6M64 48 100.5 105M64 48 91.9 72.8M64 48 88.3 24.9" />
          <circle cx="64" cy="48" r="37" />
          <circle cx="64" cy="48" r="24" />
        </g>
      </svg>
    </span>
  )
}

export function ExtractionJourney() {
  return (
    <section className={styles.section} aria-labelledby="extraction-journey-title">
      <div className={styles.layout}>
        <div className={styles.copy}>
          <FeatureGlyph />
          <h2 id="extraction-journey-title" className={styles.heading}>
            Turn searches into CRM-ready records.
          </h2>
          <p className={styles.description}>
            Open Outlio on any Sales Navigator search. One click captures profiles,
            removes duplicates, verifies contact and company data, and sends clean
            records to your CRM.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            book a demo
            <span aria-hidden="true">→</span>
          </a>
        </div>

        <div
          className={styles.animationBox}
          role="img"
          aria-label="Static Outlio workflow showing a Sales Navigator search, the open Outlio browser extension, and three complete CRM contact records"
        >
          <div className={styles.browserWindow} aria-hidden="true">
            <div className={styles.browserBar}>
              <span className={styles.trafficLights}><i /><i /><i /></span>
              <span className={styles.browserAddress}>linkedin.com/sales/search/people</span>
              <span className={styles.browserExtension}><OutlioMark small /></span>
            </div>

            <div className={styles.salesNavigator}>
              <header className={styles.salesNavHeader}>
                <span className={styles.linkedinLogo}>in</span>
                <strong>Sales Navigator</strong>
                <nav><span>Home</span><span>Accounts</span><span>Leads</span></nav>
              </header>
              <div className={styles.salesNavTabs}>
                <strong>Lead</strong><span>Account</span><b>6M+ results</b>
              </div>
              <div className={styles.salesNavBody}>
                <aside className={styles.salesFilters}>
                  <div><small>Company</small><strong>Current company</strong><span>＋ Meridian Forge</span></div>
                  <div><small>Role</small><strong>Function</strong><span>＋ Business Development</span></div>
                  <div><small>Personal</small><strong>Geography</strong><span>＋ North America</span></div>
                </aside>
                <div className={styles.salesResults}>
                  <div className={styles.salesSearch}><span>⌕</span> Search keywords</div>
                  <div className={styles.salesSelect}><i /> Select all <span>Save to list</span></div>
                  {SALES_NAV_PROFILES.map((profile, index) => (
                    <article className={styles.salesProfile} key={profile.name}>
                      <i className={styles.checkbox} />
                      <span className={`${styles.avatar} ${styles[`avatar${index + 1}`]}`}>{profile.initials}</span>
                      <span className={styles.salesIdentity}>
                        <strong>{profile.name} <i>· 2nd</i></strong>
                        <b>{profile.role} · {profile.company}</b>
                        <small>Greater San Francisco Bay Area</small>
                      </span>
                      <button type="button" tabIndex={-1}>Save</button>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.extensionPanel}>
              <div className={styles.extensionHeading}>
                <OutlioMark small />
                <span><strong>Outlio</strong><small>Lead Engine extension</small></span>
                <b>×</b>
              </div>
              <div className={styles.extensionContent}>
                <span className={styles.detected}>Search detected</span>
                <strong>3 profiles ready</strong>
                <small>Duplicates removed · contacts verified</small>
                <span className={styles.extractButton}>Extract to CRM <b>→</b></span>
              </div>
            </div>

            <div className={styles.crmTable}>
              <header className={styles.crmHeader}>
                <div className={styles.crmTitle}>
                  <span className={styles.crmIcon}><CrmMark /></span>
                  <span><strong>CRM Contacts <b>3</b></strong><small>Complete, verified records from this search</small></span>
                </div>
                <span className={styles.crmSynced}>✓ Synced</span>
              </header>
              <div className={styles.crmColumns}>
                <span>Member</span><span>Status</span><span>Role</span><span>Company</span><span>Direct contact</span>
              </div>
              <div className={styles.crmRows}>
                {CRM_PROFILES.map((profile, index) => (
                  <article className={styles.crmRow} key={profile.name}>
                    <span className={styles.crmMember}>
                      <span className={`${styles.avatar} ${styles[`avatar${index + 1}`]}`}>{profile.initials}</span>
                      <span><strong>{profile.name}</strong><small>{profile.email}</small></span>
                    </span>
                    <span className={styles.crmStatus}>{profile.status}</span>
                    <span className={styles.crmRole}>{profile.role}</span>
                    <span className={styles.crmCompany}><strong>{profile.company}</strong><small>{profile.website}</small></span>
                    <span className={styles.crmContact}><strong>{profile.phone}</strong><small>LinkedIn {profile.linkedin}</small></span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
