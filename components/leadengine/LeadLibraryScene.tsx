'use client'

import { useEffect, useRef, useState } from 'react'

export type LibrarySceneLead = {
  id: string
  initials: string
  name: string
}

type LeadLibrarySceneProps = {
  leads: LibrarySceneLead[]
  activeLeadId?: string
  onActivate: (leadId: string, trigger: HTMLElement) => void
  onReadyChange: (ready: boolean) => void
}

const BOOK_COLORS = [
  0xc9775d,
  0xe7ad72,
  0xeee6da,
  0xa8beb5,
  0xd99a79,
  0xe8c28b,
  0xcfd9d4,
  0xd2694b,
] as const

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function LeadLibraryScene({
  leads,
  activeLeadId,
  onActivate,
  onReadyChange,
}: LeadLibrarySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activateRef = useRef(onActivate)
  const activeLeadRef = useRef(activeLeadId)
  const [focusedLeadName, setFocusedLeadName] = useState(leads[0]?.name ?? '')

  useEffect(() => {
    activateRef.current = onActivate
  }, [onActivate])

  useEffect(() => {
    activeLeadRef.current = activeLeadId
  }, [activeLeadId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let disposeScene: (() => void) | undefined
    onReadyChange(false)

    Promise.all([
      import('three'),
      import('three/examples/jsm/geometries/RoundedBoxGeometry.js'),
    ])
      .then(([THREE, { RoundedBoxGeometry }]) => {
        if (cancelled) return

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 40)
        camera.position.set(0, -0.28, 10.4)

        let renderer: InstanceType<typeof THREE.WebGLRenderer>
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
          })
        } catch {
          onReadyChange(false)
          return
        }

        renderer.setClearColor(0x000000, 0)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, finePointer.matches ? 2 : 1.5))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.06
        renderer.shadowMap.enabled = finePointer.matches && window.innerWidth >= 768
        renderer.shadowMap.type = THREE.PCFSoftShadowMap
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.style.width = '100%'
        renderer.domElement.style.height = '100%'
        renderer.domElement.style.display = 'block'
        host.appendChild(renderer.domElement)

        scene.add(new THREE.HemisphereLight(0xfff5e8, 0x2d160d, 2.1))

        const keyLight = new THREE.DirectionalLight(0xfff4df, 4.4)
        keyLight.position.set(-3.8, 6.5, 6.8)
        keyLight.castShadow = renderer.shadowMap.enabled
        keyLight.shadow.mapSize.set(1024, 1024)
        keyLight.shadow.camera.near = 1
        keyLight.shadow.camera.far = 18
        keyLight.shadow.camera.left = -5
        keyLight.shadow.camera.right = 5
        keyLight.shadow.camera.top = 5
        keyLight.shadow.camera.bottom = -5
        keyLight.shadow.bias = -0.0008
        keyLight.shadow.normalBias = 0.025
        keyLight.shadow.radius = 3
        scene.add(keyLight)

        const warmLight = new THREE.PointLight(0xe07002, 28, 13, 1.7)
        warmLight.position.set(3.2, 1.4, 4.2)
        scene.add(warmLight)

        const rimLight = new THREE.PointLight(0xb9d4de, 15, 11, 1.9)
        rimLight.position.set(-3.4, 2.4, 2.8)
        scene.add(rimLight)

        const root = new THREE.Group()
        scene.add(root)

        // The page is the visible floor; this transparent receiver gives the
        // shelf and visitor real contact shadows without adding another board.
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(10.5, 6.2),
          new THREE.ShadowMaterial({ color: 0x5c3b26, opacity: 0.17 }),
        )
        floor.position.set(0, -3.22, 1.25)
        floor.rotation.x = -Math.PI / 2
        floor.receiveShadow = renderer.shadowMap.enabled
        root.add(floor)

        // A pair of inexpensive baked contact shadows stays visible even on
        // compact devices where the live shadow map is deliberately disabled.
        // They ground the case and the visitor without adding another surface.
        const contactShadowCanvas = document.createElement('canvas')
        contactShadowCanvas.width = 256
        contactShadowCanvas.height = 256
        const contactShadowContext = contactShadowCanvas.getContext('2d')
        if (contactShadowContext) {
          const gradient = contactShadowContext.createRadialGradient(128, 128, 8, 128, 128, 124)
          gradient.addColorStop(0, 'rgba(42, 23, 13, 0.72)')
          gradient.addColorStop(0.48, 'rgba(42, 23, 13, 0.34)')
          gradient.addColorStop(1, 'rgba(42, 23, 13, 0)')
          contactShadowContext.fillStyle = gradient
          contactShadowContext.fillRect(0, 0, 256, 256)
        }
        const contactShadowTexture = new THREE.CanvasTexture(contactShadowCanvas)
        contactShadowTexture.colorSpace = THREE.SRGBColorSpace

        const addContactShadow = (
          width: number,
          depth: number,
          x: number,
          z: number,
          opacity: number,
        ) => {
          const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(width, depth),
            new THREE.MeshBasicMaterial({
              map: contactShadowTexture,
              color: 0x4c2d1b,
              transparent: true,
              opacity,
              depthWrite: false,
              toneMapped: false,
            }),
          )
          shadow.position.set(x, -3.205, z)
          shadow.rotation.x = -Math.PI / 2
          shadow.renderOrder = 1
          root.add(shadow)
        }

        addContactShadow(6.45, 1.28, 0, 0.08, 0.28)
        addContactShadow(0.92, 0.7, 0, 1.58, 0.36)

        const shelfMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xe8cbaa,
          roughness: 0.52,
          metalness: 0,
          clearcoat: 0.24,
          clearcoatRoughness: 0.62,
        })
        const shelfEdgeMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xf4dfc4,
          roughness: 0.42,
          clearcoat: 0.34,
          clearcoatRoughness: 0.5,
        })
        const backMaterial = new THREE.MeshStandardMaterial({
          color: 0xaa805f,
          roughness: 0.86,
        })
        const personMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xe9d2b4,
          roughness: 0.62,
          clearcoat: 0.12,
          clearcoatRoughness: 0.7,
        })
        const skinMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xc9916f,
          roughness: 0.72,
          clearcoat: 0.04,
        })
        const pantsMaterial = new THREE.MeshStandardMaterial({
          color: 0xd4ac80,
          roughness: 0.82,
        })
        const hairMaterial = new THREE.MeshStandardMaterial({
          color: 0x3c2b23,
          roughness: 0.96,
        })
        const shoeMaterial = new THREE.MeshStandardMaterial({
          color: 0x4b392f,
          roughness: 0.92,
        })

        const addBox = (
          width: number,
          height: number,
          depth: number,
          x: number,
          y: number,
          z: number,
          material: InstanceType<typeof THREE.MeshPhysicalMaterial> | InstanceType<typeof THREE.MeshStandardMaterial>,
          radius = 0.06,
        ) => {
          const geometry = new RoundedBoxGeometry(1, 1, 1, 3, radius)
          const mesh = new THREE.Mesh(geometry, material)
          mesh.scale.set(width, height, depth)
          mesh.position.set(x, y, z)
          mesh.castShadow = renderer.shadowMap.enabled
          mesh.receiveShadow = true
          root.add(mesh)
          return mesh
        }

        const roundedRect = (
          path: InstanceType<typeof THREE.Path>,
          x: number,
          y: number,
          width: number,
          height: number,
          radius: number,
          reverse = false,
        ) => {
          if (!reverse) {
            path.moveTo(x + radius, y)
            path.lineTo(x + width - radius, y)
            path.quadraticCurveTo(x + width, y, x + width, y + radius)
            path.lineTo(x + width, y + height - radius)
            path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
            path.lineTo(x + radius, y + height)
            path.quadraticCurveTo(x, y + height, x, y + height - radius)
            path.lineTo(x, y + radius)
            path.quadraticCurveTo(x, y, x + radius, y)
            return
          }

          path.moveTo(x + radius, y)
          path.quadraticCurveTo(x, y, x, y + radius)
          path.lineTo(x, y + height - radius)
          path.quadraticCurveTo(x, y + height, x + radius, y + height)
          path.lineTo(x + width - radius, y + height)
          path.quadraticCurveTo(x + width, y + height, x + width, y + height - radius)
          path.lineTo(x + width, y + radius)
          path.quadraticCurveTo(x + width, y, x + width - radius, y)
          path.lineTo(x + radius, y)
        }

        // A single extruded ring gives the case one uninterrupted curve around
        // all four corners, instead of assembling the perimeter from boards.
        const frameShape = new THREE.Shape()
        roundedRect(frameShape, -3.24, -3.1, 6.48, 6.2, 0.54)
        const frameOpening = new THREE.Path()
        roundedRect(frameOpening, -2.86, -2.72, 5.72, 5.44, 0.3, true)
        frameShape.holes.push(frameOpening)
        const frameGeometry = new THREE.ExtrudeGeometry(frameShape, {
          depth: 0.48,
          steps: 1,
          curveSegments: 20,
          bevelEnabled: true,
          bevelSegments: 4,
          bevelSize: 0.07,
          bevelThickness: 0.07,
        })
        const shelfFrameMesh = new THREE.Mesh(frameGeometry, shelfEdgeMaterial)
        shelfFrameMesh.position.z = -0.28
        shelfFrameMesh.castShadow = renderer.shadowMap.enabled
        shelfFrameMesh.receiveShadow = true
        root.add(shelfFrameMesh)

        const back = new THREE.Mesh(
          new RoundedBoxGeometry(5.72, 5.44, 0.26, 5, 0.3),
          backMaterial,
        )
        back.position.set(0, 0, -0.38)
        back.receiveShadow = true
        root.add(back)

        addBox(0.2, 5.68, 0.5, -1.02, 0.1, -0.02, shelfMaterial)
        addBox(0.2, 5.68, 0.5, 1.02, 0.1, -0.02, shelfMaterial)

        const shelfY = [-2.46, -1.38, -0.3, 0.78, 1.86]
        shelfY.forEach((y) => addBox(5.74, 0.22, 0.68, 0, y, 0.02, shelfMaterial, 0.1))
        // The top canopy sits in front of the books so the first row reads as
        // enclosed within the case rather than floating above the shelves.
        addBox(5.74, 0.3, 0.8, 0, 2.79, 0.04, shelfEdgeMaterial, 0.12)

        const bookGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.045)
        const bookMaterials = BOOK_COLORS.map(
          (color) =>
            new THREE.MeshPhysicalMaterial({
              color,
              roughness: 0.5,
              clearcoat: 0.3,
              clearcoatRoughness: 0.48,
            }),
        )
        const decorativeByColor: Array<Array<InstanceType<typeof THREE.Matrix4>>> = BOOK_COLORS.map(() => [])
        const interactiveBooks: Array<InstanceType<typeof THREE.Mesh>> = []
        const interactiveSlots = new Map<string, LibrarySceneLead>()
        const usedSlots = new Set<string>()

        leads.forEach((lead, index) => {
          const row = index % 5
          const bay = Math.floor(index / 5) % 3
          let slot = 1 + ((index * 3 + row) % 7)
          while (usedSlots.has(`${row}-${bay}-${slot}`)) slot = (slot + 1) % 9
          const slotKey = `${row}-${bay}-${slot}`
          usedSlots.add(slotKey)
          interactiveSlots.set(slotKey, lead)
        })

        const random = seededRandom(0x7b0e00)
        const bayCenters = [-2.03, 0, 2.03]
        const bookWidth = 0.165
        const bookGap = 0.024

        shelfY.forEach((shelfTop, row) => {
          bayCenters.forEach((bayX, bay) => {
            for (let slot = 0; slot < 9; slot += 1) {
              const height = row === shelfY.length - 1
                ? 0.55 + random() * 0.16
                : 0.63 + random() * 0.28
              const depth = 0.31 + random() * 0.09
              const x = bayX - 0.77 + slot * (bookWidth + bookGap)
              const y = shelfTop + 0.13 + height / 2
              const z = 0.14 + (random() - 0.5) * 0.055
              const rotationZ = (random() - 0.5) * 0.055
              const colorIndex = (row * 3 + bay + slot * 2) % BOOK_COLORS.length
              const lead = interactiveSlots.get(`${row}-${bay}-${slot}`)

              if (lead) {
                const material = bookMaterials[colorIndex].clone()
                material.emissive = new THREE.Color(0xfff3df)
                material.emissiveIntensity = 0.055
                const book = new THREE.Mesh(bookGeometry, material)
                book.scale.set(bookWidth, height, depth)
                book.position.set(x, y, z)
                book.rotation.z = rotationZ
                book.castShadow = renderer.shadowMap.enabled
                book.userData = {
                  leadId: lead.id,
                  leadName: lead.name,
                  baseZ: z,
                  baseRotationY: 0,
                  targetZ: z,
                  targetRotationY: 0,
                  targetGlow: 0.055,
                }
                root.add(book)
                interactiveBooks.push(book)
              } else {
                const matrix = new THREE.Matrix4()
                const position = new THREE.Vector3(x, y, z)
                const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotationZ))
                const scale = new THREE.Vector3(bookWidth, height, depth)
                matrix.compose(position, rotation, scale)
                decorativeByColor[colorIndex].push(matrix)
              }
            }
          })
        })

        decorativeByColor.forEach((matrices, colorIndex) => {
          if (!matrices.length) return
          const books = new THREE.InstancedMesh(bookGeometry, bookMaterials[colorIndex], matrices.length)
          matrices.forEach((matrix, index) => books.setMatrixAt(index, matrix))
          books.instanceMatrix.needsUpdate = true
          books.castShadow = renderer.shadowMap.enabled
          books.receiveShadow = true
          root.add(books)
        })

        const person = new THREE.Group()
        person.position.set(0, -2.465, 1.55)
        person.scale.setScalar(1.18)
        root.add(person)

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 24), skinMaterial)
        head.position.y = 0.94
        head.scale.set(0.94, 1.08, 0.96)
        head.castShadow = renderer.shadowMap.enabled
        person.add(head)

        const hair = new THREE.Mesh(
          new THREE.SphereGeometry(0.194, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.54),
          hairMaterial,
        )
        hair.position.set(0, 0.965, -0.002)
        hair.scale.set(0.95, 1.06, 0.98)
        hair.castShadow = renderer.shadowMap.enabled
        person.add(hair)

        ;[-0.183, 0.183].forEach((x) => {
          const ear = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), skinMaterial)
          ear.position.set(x, 0.94, 0)
          person.add(ear)
        })

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.072, 0.14, 18), skinMaterial)
        neck.position.y = 0.73
        neck.castShadow = renderer.shadowMap.enabled
        person.add(neck)

        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.28, 8, 24), personMaterial)
        body.position.y = 0.48
        body.scale.set(1.08, 1, 0.8)
        body.castShadow = renderer.shadowMap.enabled
        person.add(body)

        const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.16, 0.24, 4, 0.08), pantsMaterial)
        pelvis.position.y = 0.18
        pelvis.castShadow = renderer.shadowMap.enabled
        person.add(pelvis)

        const up = new THREE.Vector3(0, 1, 0)
        const addSegment = (
          from: InstanceType<typeof THREE.Vector3>,
          to: InstanceType<typeof THREE.Vector3>,
          radius: number,
          material: InstanceType<typeof THREE.Material>,
        ) => {
          const direction = to.clone().sub(from)
          const length = direction.length()
          const limb = new THREE.Mesh(
            new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), 6, 12),
            material,
          )
          limb.position.copy(from).add(to).multiplyScalar(0.5)
          limb.quaternion.setFromUnitVectors(up, direction.normalize())
          limb.castShadow = renderer.shadowMap.enabled
          person.add(limb)
          return limb
        }

        const addJoint = (
          point: InstanceType<typeof THREE.Vector3>,
          radius: number,
          material: InstanceType<typeof THREE.Material>,
        ) => {
          const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material)
          joint.position.copy(point)
          joint.castShadow = renderer.shadowMap.enabled
          person.add(joint)
        }

        const leftShoulder = new THREE.Vector3(-0.19, 0.61, 0)
        const rightShoulder = new THREE.Vector3(0.19, 0.61, 0)
        const leftHand = new THREE.Vector3(-0.28, 0.2, 0.025)
        const rightHand = new THREE.Vector3(0.28, 0.2, 0.025)
        addSegment(leftShoulder, leftHand, 0.061, personMaterial)
        addSegment(rightShoulder, rightHand, 0.061, personMaterial)
        addJoint(leftHand, 0.057, skinMaterial)
        addJoint(rightHand, 0.057, skinMaterial)

        const leftHip = new THREE.Vector3(-0.105, 0.16, 0)
        const rightHip = new THREE.Vector3(0.105, 0.16, 0)
        const leftAnkle = new THREE.Vector3(-0.145, -0.52, 0.025)
        const rightAnkle = new THREE.Vector3(0.145, -0.52, 0.025)
        addSegment(leftHip, leftAnkle, 0.067, pantsMaterial)
        addSegment(rightHip, rightAnkle, 0.067, pantsMaterial)

        const shoeGeometry = new RoundedBoxGeometry(0.18, 0.1, 0.3, 3, 0.045)
        ;[-0.145, 0.145].forEach((x) => {
          const shoe = new THREE.Mesh(shoeGeometry, shoeMaterial)
          shoe.position.set(x, -0.59, 0.085)
          shoe.castShadow = renderer.shadowMap.enabled
          person.add(shoe)
        })

        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2(0, 0)
        let pointerTargetX = 0
        let pointerTargetY = 0
        let hoveredBook: InstanceType<typeof THREE.Mesh> | null = null
        let keyboardIndex = 0
        let visible = true
        let frame = 0
        let lastTime = performance.now()

        const setHoveredBook = (next: InstanceType<typeof THREE.Mesh> | null) => {
          if (hoveredBook === next) return
          hoveredBook = next
          interactiveBooks.forEach((book) => {
            const selected = book === next
            const active = book.userData.leadId === activeLeadRef.current
            book.userData.targetZ = book.userData.baseZ + (selected && !reducedMotion.matches ? 0.42 : 0)
            book.userData.targetRotationY = selected && !reducedMotion.matches ? -0.16 : 0
            book.userData.targetGlow = selected ? 0.22 : active ? 0.11 : 0.055
          })
          host.style.cursor = next ? 'pointer' : 'default'
        }

        const updateRaycast = () => {
          raycaster.setFromCamera(pointer, camera)
          const hit = raycaster.intersectObjects(interactiveBooks, false)[0]
          setHoveredBook((hit?.object as InstanceType<typeof THREE.Mesh>) ?? null)
        }

        const move = (event: PointerEvent) => {
          if (!finePointer.matches) return
          const bounds = host.getBoundingClientRect()
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
          pointerTargetX = pointer.x
          pointerTargetY = pointer.y
          updateRaycast()
          if (reducedMotion.matches) renderOnce()
        }

        const leave = () => {
          pointerTargetX = 0
          pointerTargetY = 0
          setHoveredBook(null)
          if (reducedMotion.matches) renderOnce()
        }

        const click = () => {
          if (!hoveredBook) return
          activateRef.current(hoveredBook.userData.leadId, host)
        }

        const keydown = (event: KeyboardEvent) => {
          if (!interactiveBooks.length) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault()
            keyboardIndex = (keyboardIndex + 1) % interactiveBooks.length
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault()
            keyboardIndex = (keyboardIndex - 1 + interactiveBooks.length) % interactiveBooks.length
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            const book = interactiveBooks[keyboardIndex]
            activateRef.current(book.userData.leadId, host)
            return
          } else {
            return
          }

          const book = interactiveBooks[keyboardIndex]
          setHoveredBook(book)
          setFocusedLeadName(book.userData.leadName)
          if (reducedMotion.matches) renderOnce()
        }

        const resize = () => {
          const bounds = host.getBoundingClientRect()
          const width = Math.max(1, bounds.width)
          const height = Math.max(1, bounds.height)
          camera.aspect = width / height
          camera.position.z = width / height < 0.92 ? 15.2 : 10.4
          camera.updateProjectionMatrix()
          renderer.setSize(width, height, false)
        }

        const draw = (time: number) => {
          const delta = Math.min(40, time - lastTime)
          lastTime = time
          const smoothing = 1 - Math.pow(0.001, delta / 1000)
          const motion = reducedMotion.matches ? 0 : 1

          interactiveBooks.forEach((book) => {
            book.position.z += (book.userData.targetZ - book.position.z) * smoothing
            book.rotation.y += (book.userData.targetRotationY - book.rotation.y) * smoothing
            const material = book.material as InstanceType<typeof THREE.MeshPhysicalMaterial>
            material.emissiveIntensity += (book.userData.targetGlow - material.emissiveIntensity) * smoothing
          })

          head.rotation.y += (pointerTargetX * 0.22 * motion - head.rotation.y) * smoothing
          head.rotation.x += (-pointerTargetY * 0.09 * motion - head.rotation.x) * smoothing
          renderer.render(scene, camera)

          if (visible && !reducedMotion.matches) frame = window.requestAnimationFrame(draw)
        }

        function renderOnce() {
          window.cancelAnimationFrame(frame)
          lastTime = performance.now()
          frame = window.requestAnimationFrame(draw)
        }

        const resizeObserver = new ResizeObserver(() => {
          resize()
          renderOnce()
        })
        const visibilityObserver = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting && document.visibilityState === 'visible'
          if (visible) renderOnce()
          else window.cancelAnimationFrame(frame)
        })
        const visibilityChange = () => {
          visible = document.visibilityState === 'visible' && host.getBoundingClientRect().bottom > 0
          if (visible) renderOnce()
          else window.cancelAnimationFrame(frame)
        }
        const motionChange = () => renderOnce()

        resize()
        resizeObserver.observe(host)
        visibilityObserver.observe(host)
        host.addEventListener('pointermove', move)
        host.addEventListener('pointerleave', leave)
        host.addEventListener('click', click)
        host.addEventListener('keydown', keydown)
        document.addEventListener('visibilitychange', visibilityChange)
        reducedMotion.addEventListener('change', motionChange)
        onReadyChange(true)
        renderOnce()

        disposeScene = () => {
          window.cancelAnimationFrame(frame)
          resizeObserver.disconnect()
          visibilityObserver.disconnect()
          host.removeEventListener('pointermove', move)
          host.removeEventListener('pointerleave', leave)
          host.removeEventListener('click', click)
          host.removeEventListener('keydown', keydown)
          document.removeEventListener('visibilitychange', visibilityChange)
          reducedMotion.removeEventListener('change', motionChange)

          const geometries = new Set<InstanceType<typeof THREE.BufferGeometry>>()
          const materials = new Set<InstanceType<typeof THREE.Material>>()
          scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return
            geometries.add(object.geometry)
            const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
            objectMaterials.forEach((material) => materials.add(material))
          })
          geometries.forEach((geometry) => geometry.dispose())
          materials.forEach((material) => material.dispose())
          contactShadowTexture.dispose()
          renderer.dispose()
          renderer.domElement.remove()
          onReadyChange(false)
        }
      })
      .catch(() => onReadyChange(false))

    return () => {
      cancelled = true
      disposeScene?.()
    }
  }, [leads, onReadyChange])

  return (
    <div
      ref={hostRef}
      className="library-three-scene"
      role="application"
      tabIndex={0}
      aria-label="Interactive 3D lead library. Use arrow keys to browse highlighted lead books and Enter to open one."
    >
      <span className="sr-only" aria-live="polite">
        {focusedLeadName ? `Selected lead: ${focusedLeadName}` : ''}
      </span>
    </div>
  )
}
