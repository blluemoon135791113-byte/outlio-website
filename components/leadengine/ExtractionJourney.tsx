'use client'

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

function CursorIcon() {
  return (
    <svg viewBox="0 0 28 34" aria-hidden="true">
      <path
        d="M3.3 2.4 24.8 20c1 .82.42 2.45-.87 2.43l-8.18-.07 3.86 7.29-4.1 2.16-3.84-7.26-5.15 6.09c-.84 1-2.5.4-2.48-.9L3.3 2.4Z"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function OutlioMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`${styles.outlioMark} ${small ? styles.outlioMarkSmall : ''}`} aria-hidden="true">
      <span />
    </span>
  )
}

function FeatureGlyph() {
  return (
    <span className={styles.featureGlyph} aria-hidden="true">
      <span className={styles.glyphTarget} />
      <span className={styles.glyphCursor}>◆</span>
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
            From a saved search to sales-ready records.
          </h2>
          <p className={styles.description}>
            Open the extension on the Sales Navigator search you already built. One
            click captures the visible profiles, removes duplicates, and enriches each
            lead with verified contact and company intelligence—ready for your CRM.
          </p>
          <p className={styles.offer}>
            Start with up to 250 leads in the trial. Exporting the finished list stays free.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            book a demo
            <span aria-hidden="true">→</span>
          </a>
        </div>

        <div
          className={styles.animationBox}
          role="img"
          aria-label="Short animated demonstration of a synthetic Sales Navigator search being extracted through the Outlio extension into a compact enriched CRM table"
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
                <nav><span>Home</span><span>Accounts</span><span>Leads</span><span>Messaging</span></nav>
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
                        <em>1 mutual connection&nbsp;&nbsp; · &nbsp;&nbsp;2 recent posts</em>
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
                <span><strong>Outlio</strong><small>Lead Engine</small></span>
                <b>×</b>
              </div>
              <div className={styles.extensionContent}>
                <span className={styles.detected}>Search detected</span>
                <strong>3 profiles ready</strong>
                <small>Duplicates are removed before enrichment.</small>
                <button type="button" tabIndex={-1} className={styles.extractButton}>
                  Extract profiles <span>→</span>
                </button>
                <div className={styles.progress}><span /></div>
                <p>Enriching contacts…</p>
              </div>
            </div>

            <div className={styles.syncPanel}>
              <header>
                <span className={styles.syncMark}><OutlioMark small /></span>
                <span><strong>Preparing CRM records</strong><small>Field mapping and verification</small></span>
                <b>3 leads</b>
              </header>
              <ol>
                <li><span>1</span><p><strong>Capture</strong><small>3 visible profiles collected</small></p><b>✓</b></li>
                <li><span>2</span><p><strong>Clean</strong><small>Duplicates checked across prior lists</small></p><b>✓</b></li>
                <li><span>3</span><p><strong>Enrich</strong><small>Email, phone and LinkedIn verified</small></p><b>✓</b></li>
                <li><span>4</span><p><strong>Map to CRM</strong><small>Company, website, role and source retained</small></p><b>✓</b></li>
              </ol>
              <footer><span>Destination</span><strong>CRM · Contacts</strong><i>Syncing →</i></footer>
            </div>

            <div className={styles.crmTable}>
              <header className={styles.crmHeader}>
                <div className={styles.crmTitle}>
                  <span className={styles.crmIcon}><OutlioMark small /></span>
                  <span><strong>CRM Contacts <b>3</b></strong><small>Manage enriched people and sync status.</small></span>
                </div>
                <span className={styles.crmSynced}>✓ Synced just now</span>
              </header>
              <div className={styles.crmToolbar}>
                <span>⌕&nbsp;&nbsp;Search contacts…</span>
                <div className={styles.crmActions}>
                  <button type="button" tabIndex={-1}>View&nbsp;&nbsp;⌄</button>
                  <button type="button" tabIndex={-1}>Export</button>
                </div>
              </div>
              <div className={styles.crmColumns}>
                <span /><span>Member</span><span>Status</span><span>Role</span><span>Company</span><span>Direct contact</span><span />
              </div>
              <div className={styles.crmRows}>
                {CRM_PROFILES.map((profile, index) => (
                  <article className={styles.crmRow} key={profile.name}>
                    <i className={styles.checkbox} />
                    <span className={styles.crmMember}>
                      <span className={`${styles.avatar} ${styles[`avatar${index + 1}`]}`}>{profile.initials}</span>
                      <span><strong>{profile.name}</strong><small>{profile.email}</small></span>
                    </span>
                    <span className={styles.crmStatus}>{profile.status}</span>
                    <span className={styles.crmRole}>{profile.role}</span>
                    <span className={styles.crmCompany}><strong>{profile.company}</strong><small>{profile.website}</small></span>
                    <span className={styles.crmContact}><strong>{profile.phone}</strong><small>LinkedIn {profile.linkedin}</small></span>
                    <button type="button" tabIndex={-1} className={styles.crmMore} aria-label={`More actions for ${profile.name}`}>•••</button>
                  </article>
                ))}
              </div>
              <footer>
                <span className={styles.crmSelection}><strong>1 of 3</strong> selected</span>
                <span>Rows per page&nbsp; 10&nbsp;&nbsp;&nbsp; Page 1 of 1&nbsp;&nbsp; ‹ &nbsp;›</span>
              </footer>
            </div>

            <div className={styles.successToast}>
              <span>✓</span>
              <p><strong>Extraction complete</strong><small>3 enriched profiles added to CRM</small></p>
            </div>

            <div className={styles.cursor}><CursorIcon /><span /></div>
          </div>

          <div className={styles.animationCaption} aria-hidden="true">
            <span className={styles.captionCapture}>1&nbsp; Capture</span><i />
            <span className={styles.captionEnrich}>2&nbsp; Enrich + map</span><i />
            <span className={styles.captionCrm}>3&nbsp; CRM ready</span>
          </div>
        </div>
      </div>
    </section>
  )
}
