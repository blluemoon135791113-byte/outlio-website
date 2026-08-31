'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import styles from './CrmEnrichmentExperience.module.css'

const STAGES = [
  {
    index: '01',
    title: 'Enrich',
    short: 'Research every record',
    metric: 'More complete records',
    label: 'Research layer',
    copy: 'Combine company websites, reputable publications, public profiles, registries, and specialist sources into one evidence-backed lead record.',
  },
  {
    index: '02',
    title: 'Score',
    short: 'Resolve the evidence',
    metric: 'Evidence you can trust',
    label: 'Confidence layer',
    copy: 'Cross-check independent sources, preserve conflicts, and attach confidence and provenance to every important fact.',
  },
  {
    index: '03',
    title: 'Sync',
    short: 'Update your workflow',
    metric: 'Intelligence in motion',
    label: 'Activation layer',
    copy: 'Deduplicate the final record and sync useful fields, research summaries, contacts, and buying signals into your CRM workflow.',
  },
] as const

export function CrmEnrichmentExperience() {
  const sceneRef = useRef<HTMLDivElement>(null)
  const activeStageRef = useRef(0)
  const [activeStage, setActiveStage] = useState(0)
  const [sceneStatus, setSceneStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const stage = STAGES[activeStage]
  const activateStage = (index: number) => {
    activeStageRef.current = index
    setActiveStage(index)
  }

  useEffect(() => {
    const mount = sceneRef.current
    if (!mount) return

    let cancelled = false
    let disposeScene: (() => void) | undefined

    Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
    ]).then(([THREE, { OrbitControls }]) => {
      if (cancelled) return

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const scene = new THREE.Scene()
      scene.fog = new THREE.FogExp2(0x000100, 0.052)

      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
      camera.position.set(0.2, 0.55, 8.7)

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      })
      if (!context) {
        setSceneStatus('fallback')
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
        setSceneStatus('fallback')
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.12
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.domElement.setAttribute('aria-hidden', 'true')
      mount.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.055
      controls.enablePan = false
      controls.enableZoom = true
      controls.minDistance = 5
      controls.maxDistance = 12
      controls.minPolarAngle = Math.PI * 0.23
      controls.maxPolarAngle = Math.PI * 0.75
      controls.autoRotate = !reducedMotion
      controls.autoRotateSpeed = 0.28

      scene.add(new THREE.AmbientLight(0xffead8, 1.3))

      const keyLight = new THREE.DirectionalLight(0xfff3dc, 4.2)
      keyLight.position.set(4.5, 7, 5)
      keyLight.castShadow = true
      keyLight.shadow.mapSize.set(1024, 1024)
      scene.add(keyLight)

      const warmLight = new THREE.PointLight(0xe07002, 40, 18, 1.7)
      warmLight.position.set(3.2, 1.4, 3.4)
      scene.add(warmLight)

      const rimLight = new THREE.PointLight(0x7b0e00, 24, 17, 1.7)
      rimLight.position.set(0.5, -1.2, -3.2)
      scene.add(rimLight)

      const root = new THREE.Group()
      scene.add(root)

      const torusGeometry = new THREE.TorusKnotGeometry(1.28, 0.37, 200, 34, 2, 3)
      const torusMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x320200,
        metalness: 0.86,
        roughness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        emissive: 0x7b0e00,
        emissiveIntensity: 0.5,
      })
      const torus = new THREE.Mesh(torusGeometry, torusMaterial)
      torus.castShadow = true
      root.add(torus)

      const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0xe07002,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const glow = new THREE.Mesh(torusGeometry, glowMaterial)
      glow.scale.setScalar(1.085)
      root.add(glow)

      const createOrbit = (
        radius: number,
        color: number,
        rotation: [number, number, number],
      ) => {
        const geometry = new THREE.TorusGeometry(radius, 0.01, 8, 150)
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        const orbit = new THREE.Mesh(geometry, material)
        orbit.rotation.set(...rotation)
        root.add(orbit)
        return orbit
      }

      const orbitA = createOrbit(2.1, 0xe07002, [1.15, 0.18, 0.36])
      const orbitB = createOrbit(2.52, 0xd13b02, [0.63, 1.05, -0.42])
      const orbitC = createOrbit(1.78, 0xffd4a1, [1.72, 0.6, 0.16])

      const coreGeometry = new THREE.IcosahedronGeometry(0.18, 2)
      const coreMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffd6a4,
        emissive: 0xe07002,
        emissiveIntensity: 4.2,
        roughness: 0.14,
      })
      const core = new THREE.Mesh(coreGeometry, coreMaterial)
      core.position.set(1.55, 1.02, 0.58)
      root.add(core)

      const particleCount = 620
      const positions = new Float32Array(particleCount * 3)
      const colors = new Float32Array(particleCount * 3)
      const warm = new THREE.Color(0xe07002)
      const pale = new THREE.Color(0xffead8)

      for (let index = 0; index < particleCount; index += 1) {
        const radius = 2.1 + Math.random() * 3.5
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const color = Math.random() > 0.74 ? warm : pale
        positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
        positions[index * 3 + 1] = radius * Math.cos(phi) * 0.68
        positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
        colors[index * 3] = color.r
        colors[index * 3 + 1] = color.g
        colors[index * 3 + 2] = color.b
      }

      const particleGeometry = new THREE.BufferGeometry()
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const particleMaterial = new THREE.PointsMaterial({
        size: 0.024,
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const particles = new THREE.Points(particleGeometry, particleMaterial)
      root.add(particles)

      const pointer = new THREE.Vector2(2, 2)
      const pointerTarget = new THREE.Vector2()
      const smoothPointer = new THREE.Vector2()
      const raycaster = new THREE.Raycaster()
      const clock = new THREE.Clock()
      const stageColors = [
        new THREE.Color(0xe07002),
        new THREE.Color(0xd13b02),
        new THREE.Color(0x7b0e00),
      ]
      let hovered = false
      let frame = 0
      let inView = false
      let pageVisible = !document.hidden
      let running = false

      const updateLayout = () => {
        const width = mount.clientWidth
        const height = mount.clientHeight
        camera.aspect = width / Math.max(height, 1)
        camera.updateProjectionMatrix()
        renderer.setSize(width, height, false)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))

        if (width < 720) {
          root.position.set(0.15, -0.65, -0.4)
          root.scale.setScalar(0.76)
          controls.target.set(0.1, -0.45, 0)
        } else if (width < 1060) {
          root.position.set(1.9, -0.05, 0)
          root.scale.setScalar(0.9)
          controls.target.set(1.55, 0, 0)
        } else {
          root.position.set(2.55, 0, 0)
          root.scale.setScalar(1)
          controls.target.set(2, 0.05, 0)
        }
      }

      const updatePointer = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
        pointerTarget.copy(pointer)
      }

      const pointerLeave = () => {
        pointer.set(2, 2)
        pointerTarget.set(0, 0)
        hovered = false
      }

      const renderFrame = () => {
        if (!running) return
        frame = requestAnimationFrame(renderFrame)
        const elapsed = clock.getElapsedTime()
        smoothPointer.lerp(pointerTarget, 0.04)
        raycaster.setFromCamera(pointer, camera)
        hovered = raycaster.intersectObject(torus, false).length > 0

        if (!reducedMotion) {
          root.rotation.y += (smoothPointer.x * 0.13 - root.rotation.y) * 0.025
          root.rotation.x += (-smoothPointer.y * 0.08 - root.rotation.x) * 0.025
          torus.rotation.y += 0.002 + activeStageRef.current * 0.00035
          torus.rotation.x = Math.sin(elapsed * 0.28) * 0.08
          glow.rotation.copy(torus.rotation)
          orbitA.rotation.z += 0.0017
          orbitB.rotation.x -= 0.0011
          orbitC.rotation.y += 0.0014
          particles.rotation.y -= 0.00065
          core.position.x = 1.55 + Math.sin(elapsed * 0.8) * 0.15
          core.position.y = 1.02 + Math.cos(elapsed * 0.68) * 0.12
          const pulse = 1 + Math.sin(elapsed * 2.2) * 0.05
          core.scale.setScalar(pulse)
          glow.scale.setScalar(1.085 + Math.sin(elapsed * 1.55) * 0.018)
        }

        torusMaterial.emissiveIntensity += ((hovered ? 1.35 : 0.5) - torusMaterial.emissiveIntensity) * 0.075
        torusMaterial.emissive.lerp(stageColors[activeStageRef.current], 0.035)
        warmLight.color.lerp(stageColors[activeStageRef.current], 0.035)
        glowMaterial.opacity += ((hovered ? 0.15 : 0.07) - glowMaterial.opacity) * 0.075
        const targetScale = hovered ? 1.045 : 1
        torus.scale.setScalar(torus.scale.x + (targetScale - torus.scale.x) * 0.075)
        warmLight.intensity = 40 + Math.sin(elapsed * 1.7) * 4 + (hovered ? 15 : 0)
        renderer.domElement.dataset.hovered = String(hovered)
        controls.update()
        renderer.render(scene, camera)
      }

      const syncAnimation = () => {
        const shouldRun = inView && pageVisible
        if (shouldRun && !running) {
          running = true
          clock.start()
          renderFrame()
        } else if (!shouldRun && running) {
          running = false
          cancelAnimationFrame(frame)
          clock.stop()
        }
      }

      const resizeObserver = new ResizeObserver(updateLayout)
      const visibilityObserver = new IntersectionObserver(
        ([entry]) => {
          inView = entry.isIntersecting
          syncAnimation()
        },
        { rootMargin: '120px' },
      )
      const handleVisibility = () => {
        pageVisible = !document.hidden
        syncAnimation()
      }

      resizeObserver.observe(mount)
      visibilityObserver.observe(mount)
      document.addEventListener('visibilitychange', handleVisibility)
      renderer.domElement.addEventListener('pointermove', updatePointer)
      renderer.domElement.addEventListener('pointerleave', pointerLeave)
      updateLayout()
      renderer.render(scene, camera)
      setSceneStatus('ready')

      disposeScene = () => {
        running = false
        cancelAnimationFrame(frame)
        resizeObserver.disconnect()
        visibilityObserver.disconnect()
        document.removeEventListener('visibilitychange', handleVisibility)
        renderer.domElement.removeEventListener('pointermove', updatePointer)
        renderer.domElement.removeEventListener('pointerleave', pointerLeave)
        controls.dispose()
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        })
        renderer.dispose()
        renderer.domElement.remove()
      }
    })

    return () => {
      cancelled = true
      disposeScene?.()
    }
  }, [])

  return (
    <section id="crm-enrichment" className={styles.section} aria-labelledby="crm-enrichment-title">
      <div
        ref={sceneRef}
        className={`${styles.scene} ${sceneStatus === 'fallback' ? styles.sceneFallback : ''}`}
        aria-hidden="true"
      />
      <div className={styles.wash} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      <div className={styles.content}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>
            <span aria-hidden className={styles.eyebrowDot} />
            Outlio CRM Enrichment
          </p>
          <h2 id="crm-enrichment-title" className={styles.heading}>
            Turn every record into a complete picture.
          </h2>
          <p className={styles.description}>
            Research contacts, companies, intent signals, and buying context—then
            send source-backed intelligence into the systems your revenue team
            already uses.
          </p>

          <div className={styles.actions}>
            <Link href="/sign-up" className={styles.primaryAction}>
              Start enriching <span aria-hidden>→</span>
            </Link>
            <Link href="/how-it-works" className={styles.secondaryAction}>
              See the workflow
            </Link>
          </div>

          <ul className={styles.proofList} aria-label="Platform capabilities">
            {['Public-source research', 'Confidence scored', 'CRM-ready'].map((item) => (
              <li key={item}><span aria-hidden>✓</span>{item}</li>
            ))}
          </ul>
        </div>

        <p className={styles.sceneLabel} aria-hidden>
          {sceneStatus === 'ready'
            ? 'Drag to explore · Scroll to zoom'
            : sceneStatus === 'fallback'
              ? 'Interactive model preview'
              : 'Preparing intelligence model'}
        </p>

        <article className={`${styles.dataCard} ${styles.personCard}`}>
          <p className={styles.dataLabel}>Contact enriched</p>
          <div className={styles.dataTitle}>
            <span className={styles.avatar}>AM</span>
            <span>Ava Morgan<small>VP Revenue · Helio</small></span>
          </div>
          <p className={styles.dataLine}><span>Business email found</span><strong>96%</strong></p>
        </article>

        <article className={`${styles.dataCard} ${styles.companyCard}`}>
          <p className={styles.dataLabel}>Buying signal</p>
          <div className={styles.dataTitle}>
            <span className={styles.avatar}>↗</span>
            <span>Sales team growth<small>18% in 90 days</small></span>
          </div>
          <p className={styles.dataLine}><span>3 independent sources</span><strong>High</strong></p>
        </article>

        <div className={styles.workflow}>
          <div className={styles.tabs} role="tablist" aria-label="Enrichment workflow">
            {STAGES.map((item, index) => {
              const active = index === activeStage
              return (
                <button
                  key={item.title}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.tab} ${active ? styles.activeTab : ''}`}
                  onClick={() => activateStage(index)}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') activateStage(index)
                  }}
                >
                  <span className={styles.tabIndex}>{item.index}</span>
                  <span className={styles.tabTitle}>{item.title}</span>
                  <span className={styles.tabShort}>{item.short}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.stageDetail} aria-live="polite">
            <p className={styles.stageMetric}>
              {stage.metric}<span>{stage.label}</span>
            </p>
            <p className={styles.stageCopy}>{stage.copy}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
