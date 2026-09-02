'use client'

import { useEffect, useRef, useState } from 'react'

import { CALENDLY_URL } from '@/app/lib/constants'

import styles from './HubbleIntelligence.module.css'

const LEADS = [
  {
    initials: 'MC',
    name: 'Maya Chen',
    title: 'VP Revenue',
    company: 'Northstar AI',
    signal: 'Series B',
    timing: 'This week',
  },
  {
    initials: 'JL',
    name: 'Jonas Lind',
    title: 'Head of Growth',
    company: 'Fieldnote',
    signal: 'Hiring +18%',
    timing: 'Tue, 10 AM',
  },
  {
    initials: 'AP',
    name: 'Ari Patel',
    title: 'RevOps Director',
    company: 'Clearframe',
    signal: 'Seed + hiring',
    timing: 'Wed, 9 AM',
  },
  {
    initials: 'SR',
    name: 'Sofia Reyes',
    title: 'COO',
    company: 'Sageworks',
    signal: 'Expansion',
    timing: 'Thu, 11 AM',
  },
] as const

function SatelliteScene() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let cancelled = false
    let dispose: (() => void) | undefined

    import('three').then((THREE) => {
      if (cancelled) return

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      })

      if (!context) {
        setStatus('fallback')
        return
      }

      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          context,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        })
      } catch {
        setStatus('fallback')
        return
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.08
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      renderer.domElement.setAttribute('aria-hidden', 'true')
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30)
      camera.position.set(0.25, 0.15, 7.4)

      scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x173e4a, 2.5))
      const key = new THREE.DirectionalLight(0xffffff, 4.2)
      key.position.set(3.5, 5, 5)
      key.castShadow = true
      key.shadow.mapSize.set(512, 512)
      scene.add(key)
      const rim = new THREE.PointLight(0x4e8eff, 18, 12, 1.8)
      rim.position.set(-3, 1.5, 2.6)
      scene.add(rim)

      const satellite = new THREE.Group()
      satellite.rotation.set(-0.18, -0.32, -0.08)
      scene.add(satellite)

      const blueMetal = new THREE.MeshPhysicalMaterial({
        color: 0x3479c8,
        metalness: 0.72,
        roughness: 0.23,
        clearcoat: 0.9,
        clearcoatRoughness: 0.16,
      })
      const paleMetal = new THREE.MeshPhysicalMaterial({
        color: 0xdce8ed,
        metalness: 0.82,
        roughness: 0.24,
      })
      const darkMetal = new THREE.MeshPhysicalMaterial({
        color: 0x183b55,
        metalness: 0.85,
        roughness: 0.2,
      })
      const goldFoil = new THREE.MeshPhysicalMaterial({
        color: 0xc99b46,
        metalness: 0.78,
        roughness: 0.31,
        clearcoat: 0.45,
      })
      const solarMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x153f75,
        metalness: 0.58,
        roughness: 0.28,
        emissive: 0x0b3264,
        emissiveIntensity: 0.35,
      })

      const bodyGeometry = new THREE.CylinderGeometry(0.42, 0.48, 1.75, 32)
      const body = new THREE.Mesh(bodyGeometry, blueMetal)
      body.rotation.z = Math.PI / 2
      body.castShadow = true
      satellite.add(body)

      const frontRimGeometry = new THREE.CylinderGeometry(0.49, 0.49, 0.24, 32)
      const frontRim = new THREE.Mesh(frontRimGeometry, paleMetal)
      frontRim.rotation.z = Math.PI / 2
      frontRim.position.x = 0.98
      frontRim.castShadow = true
      satellite.add(frontRim)

      const lensGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.255, 32)
      const lens = new THREE.Mesh(lensGeometry, darkMetal)
      lens.rotation.z = Math.PI / 2
      lens.position.x = 1.12
      satellite.add(lens)

      const aftGeometry = new THREE.CylinderGeometry(0.34, 0.43, 0.42, 24)
      const aft = new THREE.Mesh(aftGeometry, paleMetal)
      aft.rotation.z = Math.PI / 2
      aft.position.x = -1.06
      aft.castShadow = true
      satellite.add(aft)

      const ringGeometry = new THREE.TorusGeometry(0.47, 0.035, 10, 40)
      for (const x of [-0.66, -0.16, 0.38, 0.83]) {
        const ring = new THREE.Mesh(ringGeometry, x < 0 ? goldFoil : paleMetal)
        ring.rotation.y = Math.PI / 2
        ring.position.x = x
        ring.castShadow = true
        satellite.add(ring)
      }

      const dishGeometry = new THREE.ConeGeometry(0.43, 0.24, 32, 1, true)
      const dish = new THREE.Mesh(dishGeometry, paleMetal)
      dish.rotation.z = -Math.PI / 2
      dish.position.x = -1.34
      dish.castShadow = true
      satellite.add(dish)

      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.58, 12), goldFoil)
      antenna.rotation.z = Math.PI / 2
      antenna.position.set(-1.42, 0, 0)
      satellite.add(antenna)

      const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), darkMetal)
      antennaTip.position.x = -1.73
      satellite.add(antennaTip)

      const panelGeometry = new THREE.BoxGeometry(1.38, 0.58, 0.055)
      const panelTop = new THREE.Mesh(panelGeometry, solarMaterial)
      panelTop.position.set(-0.25, 0.92, 0)
      panelTop.castShadow = true
      satellite.add(panelTop)
      const panelBottom = panelTop.clone()
      panelBottom.position.y = -0.92
      satellite.add(panelBottom)

      const strutGeometry = new THREE.BoxGeometry(0.08, 0.55, 0.08)
      const strutTop = new THREE.Mesh(strutGeometry, paleMetal)
      strutTop.position.set(-0.25, 0.53, 0)
      satellite.add(strutTop)
      const strutBottom = strutTop.clone()
      strutBottom.position.y = -0.53
      satellite.add(strutBottom)

      const gridMaterial = new THREE.MeshBasicMaterial({
        color: 0x78a9db,
        transparent: true,
        opacity: 0.52,
      })
      for (const y of [-0.92, 0.92]) {
        for (const x of [-0.72, -0.48, -0.24, 0, 0.24]) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.58, 0.062), gridMaterial)
          line.position.set(x, y, 0.004)
          satellite.add(line)
        }
        const cross = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.018, 0.062), gridMaterial)
        cross.position.set(-0.25, y, 0.004)
        satellite.add(cross)
      }

      const orbitGeometry = new THREE.TorusGeometry(2.15, 0.012, 6, 128)
      const orbitMaterial = new THREE.MeshBasicMaterial({
        color: 0x75b9d7,
        transparent: true,
        opacity: 0.36,
      })
      const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial)
      orbit.rotation.set(1.1, 0.28, -0.36)
      scene.add(orbit)

      const beaconGeometry = new THREE.SphereGeometry(0.07, 16, 16)
      const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0x9be5ff })
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial)
      orbit.add(beacon)

      const shadowGeometry = new THREE.CircleGeometry(1.35, 48)
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x123b3a,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
      shadow.scale.set(1.6, 0.34, 1)
      shadow.position.set(0.1, -1.62, -0.25)
      shadow.rotation.x = -0.2
      scene.add(shadow)

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const startedAt = performance.now()
      let frame = 0
      let inView = false
      let pageVisible = !document.hidden
      let running = false

      const resize = () => {
        const width = Math.max(mount.clientWidth, 1)
        const height = Math.max(mount.clientHeight, 1)
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }

      const render = () => {
        frame = 0
        const elapsed = (performance.now() - startedAt) / 1000
        if (!reducedMotion) {
          satellite.rotation.y = -0.32 + Math.sin(elapsed * 0.55) * 0.16
          satellite.rotation.x = -0.18 + Math.sin(elapsed * 0.72) * 0.035
          satellite.position.y = Math.sin(elapsed * 0.8) * 0.06
          orbit.rotation.z = -0.36 + elapsed * 0.075
          const angle = elapsed * 0.75
          beacon.position.set(Math.cos(angle) * 2.15, Math.sin(angle) * 2.15, 0)
        }
        renderer.render(scene, camera)
        if (inView && pageVisible && !reducedMotion) frame = requestAnimationFrame(render)
      }

      const syncRunning = () => {
        const shouldRun = inView && pageVisible && !reducedMotion
        if (shouldRun && !running) {
          running = true
          frame = requestAnimationFrame(render)
        } else if (!shouldRun && running) {
          running = false
          cancelAnimationFrame(frame)
          frame = 0
        } else if (reducedMotion) {
          renderer.render(scene, camera)
        }
      }

      const intersectionObserver = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting
        syncRunning()
      }, { rootMargin: '100px' })
      intersectionObserver.observe(mount)

      const resizeObserver = new ResizeObserver(() => {
        resize()
        if (!running) renderer.render(scene, camera)
      })
      resizeObserver.observe(mount)

      const handleVisibility = () => {
        pageVisible = !document.hidden
        syncRunning()
      }
      document.addEventListener('visibilitychange', handleVisibility)

      resize()
      renderer.render(scene, camera)
      setStatus('ready')

      dispose = () => {
        cancelAnimationFrame(frame)
        intersectionObserver.disconnect()
        resizeObserver.disconnect()
        document.removeEventListener('visibilitychange', handleVisibility)
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose()
            if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
            else object.material.dispose()
          }
        })
        renderer.dispose()
        renderer.forceContextLoss()
        canvas.remove()
      }
    }).catch(() => setStatus('fallback'))

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  return (
    <div className={styles.satelliteShell} aria-hidden="true">
      <div
        ref={mountRef}
        className={`${styles.satelliteScene} ${status === 'fallback' ? styles.satelliteFallback : ''}`}
      />
    </div>
  )
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 28 34" aria-hidden="true">
      <path
        d="M3.3 2.4 24.8 20c1 .82.42 2.45-.87 2.43l-8.18-.07 3.86 7.29-4.1 2.16-3.84-7.26-5.15 6.09c-.84 1-2.5.4-2.48-.9L3.3 2.4Z"
        fill="#101817"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function HubbleIntelligence() {
  return (
    <section className={styles.section} aria-labelledby="hubble-intelligence-title">
      <div className={styles.layout}>
        <div
          className={styles.animationBox}
          role="img"
          aria-label="Animated Hubble Intelligence demo: four synthetic CRM leads are selected, analyzed for funding momentum, and ranked by the best time to reach out"
        >
          <div className={styles.glowOrb} aria-hidden="true" />
          <div className={styles.appWindow} aria-hidden="true">
            <header className={styles.windowBar}>
              <span className={styles.trafficLights}><i /><i /><i /></span>
              <span className={styles.windowTitle}><b>Hubble</b> Intelligence</span>
              <span className={styles.liveBadge}><i /> Live data</span>
            </header>

            <div className={styles.workspace}>
              <aside className={styles.intelligencePane}>
                <header className={styles.intelligenceHeading}>
                  <span className={styles.hubbleMark}>H</span>
                  <span><strong>Ask Hubble</strong><small>Growth accounts · 4 records</small></span>
                  <button type="button" tabIndex={-1} aria-label="Start a new analysis">＋</button>
                </header>

                <div className={styles.chatViewport}>
                  <div className={styles.chatTrack}>
                    <div className={styles.systemNote}>
                      <span>◎</span>
                      <p><strong>CRM connected</strong><small>Funding, hiring and engagement signals are ready.</small></p>
                    </div>
                    <div className={styles.userMessage}>
                      Which accounts show funding momentum, and when should we reach out?
                    </div>
                    <div className={styles.typingBubble}><i /><i /><i /></div>
                    <div className={styles.assistantMessage}>
                      <span className={styles.messageIcon}>✦</span>
                      <div>
                        <p>I found <strong>3 accounts</strong> entering a buying window.</p>
                        <small>Funding momentum and hiring rose together over the last 90 days.</small>
                      </div>
                    </div>
                    <div className={styles.insightCard}>
                      <span><small>Strongest signal</small><strong>Northstar AI</strong><em>Series B · 12 days ago</em></span>
                      <span><small>Best window</small><strong>Tue–Thu</strong><em>9–11 AM local</em></span>
                    </div>
                    <div className={styles.assistantMessage}>
                      <span className={styles.messageIcon}>✦</span>
                      <div>
                        <p>Lead with scaling operations, then mention hiring velocity.</p>
                        <button type="button" tabIndex={-1}>Save 3-lead segment →</button>
                      </div>
                    </div>
                  </div>
                  <span className={styles.scrollTrack}><i /></span>
                </div>

                <div className={styles.promptBar}>
                  <span className={styles.promptText}>Find the best outreach window…</span>
                  <span className={styles.recordPill}>4 leads</span>
                  <button type="button" tabIndex={-1} aria-label="Send prompt">↑</button>
                </div>
              </aside>

              <div className={styles.crmPane}>
                <header className={styles.crmHeading}>
                  <span className={styles.crmLogo}>◫</span>
                  <span><strong>CRM Leads</strong><small>Growth accounts · intelligence synced</small></span>
                  <div className={styles.crmControls}><span>⌕&nbsp; Search leads…</span><button type="button" tabIndex={-1}>Filter</button></div>
                </header>

                <div className={styles.tableHead}>
                  <span className={styles.headCheck} /><span>Member ↕</span><span>Status</span><span>Signal</span><span>Timing ↓</span>
                </div>

                <div className={styles.leadRows}>
                  {LEADS.map((lead, index) => (
                    <article className={`${styles.leadRow} ${styles[`leadRow${index + 1}`]}`} key={lead.name}>
                      <span className={styles.check}>✓</span>
                      <span className={styles.memberCell}>
                        <span className={`${styles.avatar} ${styles[`avatar${index + 1}`]}`}>{lead.initials}</span>
                        <span className={styles.identity}><strong>{lead.name}</strong><small>{lead.title} · {lead.company}</small></span>
                      </span>
                      <span className={styles.status}>{index === 3 ? 'Watch' : 'Priority'}</span>
                      <span className={styles.signal}>{lead.signal}</span>
                      <span className={styles.timing}>{lead.timing}</span>
                    </article>
                  ))}
                </div>

                <footer className={styles.crmFooter}>
                  <span><b>4</b> results</span>
                  <span>Page 1 of 1&nbsp;&nbsp; ‹ &nbsp;›</span>
                </footer>
              </div>
            </div>

            <div className={styles.cursor}><CursorIcon /><span /></div>
          </div>

          <div className={styles.animationCaption} aria-hidden="true">
            <span>CRM signals</span><i /><span>Hubble analysis</span><i /><span>Outreach window</span>
          </div>
        </div>

        <div className={styles.copy}>
          <SatelliteScene />
          <p className={styles.eyebrow}>Hubble Intelligence</p>
          <h2 id="hubble-intelligence-title" className={styles.heading}>
            See the pattern before the outreach.
          </h2>
          <p className={styles.description}>
            Ask a question across an entire lead set. Hubble connects funding,
            hiring, company, and engagement signals to surface who is moving—and
            the moment your team should reach out.
          </p>
          <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className={styles.cta}>
            book a demo <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  )
}
