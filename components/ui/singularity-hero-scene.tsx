'use client'

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import * as THREE from 'three'

/**
 * The Lead Engine hero, rendered as a WebGL scene rather than a picture.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NOTHING HERE IS A FLAT PNG ANY MORE.                                    ║
 * ║                                                                          ║
 * ║  · The starfield is ~2,600 real points spread through depth, so it       ║
 * ║    parallaxes AGAINST the hand instead of sliding with it.               ║
 * ║  · The hand is a mesh carrying the artwork as a texture.                 ║
 * ║  · The singularity is a flat black sphere held on the hole painted into  ║
 * ║    the plate. It has no rim and emits nothing; it exists only to occlude ║
 * ║    the stars behind it, because additive blending erases the painted     ║
 * ║    hole and something has to put it back.                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ADDITIVE BLENDING IS WHAT MAKES THE SOURCE USABLE AS A LAYER.
 *
 * The artwork is a lit hand on a black field with no alpha channel to cut it
 * out with. Blended additively, black contributes nothing — so the painted
 * background drops away on its own and only the lit hand survives, composited
 * over the real starfield behind it. No masking pass and no hand-cut alpha.
 * The painted singularity is a BLACK disc, so it vanishes for the same reason,
 * leaving its place free for the real one.
 *
 * ⚠️ THE HAND IS NOT DEFORMED, AND THAT IS A DECISION.
 *
 * It was: the mesh curled toward the palm on cursor proximity. Closing a
 * photographed hand needs pixels for what sits behind the fingers and a single
 * 2D plate has none, so the texture smeared at the tips and the light painted
 * around the singularity tore away from the singularity itself. The artwork is
 * carried exactly as drawn. The only motion in this scene is the starfield:
 * its slow roll, and the parallax that comes from the camera panning with the
 * pointer. The hand and the ring hold still.
 */

const SOURCE_WIDTH = 1985
const SOURCE_HEIGHT = 792
const SOURCE_ASPECT = SOURCE_WIDTH / SOURCE_HEIGHT

/** The painted singularity, as a fraction of the source. Everything anchors here. */
const ORB_SOURCE_X = 0.825
const ORB_SOURCE_Y = 0.162

/**
 * The silhouette's radius, as a fraction of the plate's WIDTH.
 *
 * ⚠️ THIS IS THE DARK CORE, NOT THE BRIGHT RIM.
 *
 * Measured by taking a radial luminance profile out from the anchor on the
 * plate in use: the core stays under lum 5 out to r=9px, climbs through 30 at
 * r=10 and peaks at 207 at r=13, then decays. So the hole is r≈9px (0.00454 of
 * width) and the ring of light around it is r≈13px (0.00656).
 *
 * The previous value was 0.0069 — the RIM's radius, taken from a different
 * plate. At that size the disc covered the painted ring completely and spilled
 * past it, which is why the luna sat on top of the crescent instead of inside
 * it. Pulled in slightly under the measured core so the silhouette tucks
 * inside the hole and never touches the light.
 */
const HOLE_RADIUS = 0.0044

const CAMERA_DISTANCE = 10
const CAMERA_FOV = 45

type SceneLayout = {
  imageHeight: number
  imageWidth: number
  imageX: number
  imageY: number
  narrow: boolean
}

type SingularityHeroSceneProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
}

/**
 * Framing, carried over unchanged from the canvas version this replaces — the
 * composition is not what the rewrite is changing. Returns host pixels; the
 * caller converts them to world units.
 */
function sceneLayout(width: number, height: number): SceneLayout {
  const narrow = width < 768

  if (narrow) {
    const imageHeight = height * 0.65
    const imageWidth = imageHeight * SOURCE_ASPECT

    return {
      imageHeight,
      imageWidth,
      imageX: width * 0.76 - imageWidth * ORB_SOURCE_X,
      imageY: height * 0.36,
      narrow,
    }
  }

  /*
   * ⚠️ SCALED AROUND THE SINGULARITY, NOT THE FRAME CENTRE.
   * `imageX/Y` below subtract the orb's fraction of the plate, so growing the
   * plate grows it outward from the hole — the composition's anchor point
   * stays put and only the hand gets bigger. Raised ~6% from 1.08/1.04.
   */
  const imageHeight = Math.max(height * 1.145, (width * 1.10) / SOURCE_ASPECT)
  const imageWidth = imageHeight * SOURCE_ASPECT

  return {
    imageHeight,
    imageWidth,
    imageX: width * 0.86 - imageWidth * ORB_SOURCE_X,
    imageY: height * 0.16 - imageHeight * ORB_SOURCE_Y,
    narrow,
  }
}

const HAND_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    /*
     * ⚠️ DELIBERATELY UNDEFORMED.
     * An earlier version curled this mesh toward the palm on cursor proximity.
     * Closing a photographed hand needs pixels for what sits behind the
     * fingers, and a single 2D plate has none — past a small amplitude the
     * texture smeared, and the light painted around the singularity tore away
     * from the singularity itself. The mesh stays flat and the artwork stays
     * exactly as drawn.
     */
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const HAND_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;

  vec3 duneRamp(float value) {
    float stepValue = clamp(value, 0.0, 1.0) * 9.0;
    vec3 c0 = vec3(0.0, 1.0, 0.0) / 255.0;
    vec3 c1 = vec3(20.0, 1.0, 4.0) / 255.0;
    vec3 c2 = vec3(50.0, 2.0, 0.0) / 255.0;
    vec3 c3 = vec3(81.0, 6.0, 0.0) / 255.0;
    vec3 c4 = vec3(123.0, 14.0, 0.0) / 255.0;
    vec3 c5 = vec3(166.0, 23.0, 2.0) / 255.0;
    vec3 c6 = vec3(209.0, 59.0, 2.0) / 255.0;
    vec3 c7 = vec3(206.0, 81.0, 2.0) / 255.0;
    vec3 c8 = vec3(221.0, 99.0, 0.0) / 255.0;
    vec3 c9 = vec3(224.0, 112.0, 2.0) / 255.0;

    if (stepValue < 1.0) return mix(c0, c1, stepValue);
    if (stepValue < 2.0) return mix(c1, c2, stepValue - 1.0);
    if (stepValue < 3.0) return mix(c2, c3, stepValue - 2.0);
    if (stepValue < 4.0) return mix(c3, c4, stepValue - 3.0);
    if (stepValue < 5.0) return mix(c4, c5, stepValue - 4.0);
    if (stepValue < 6.0) return mix(c5, c6, stepValue - 5.0);
    if (stepValue < 7.0) return mix(c6, c7, stepValue - 6.0);
    if (stepValue < 8.0) return mix(c7, c8, stepValue - 7.0);
    return mix(c8, c9, stepValue - 8.0);
  }

  void main() {
    vec4 texel = texture2D(uMap, vUv);

    /*
     * The photographed warm values are projected through the exact ten-color
     * dune ramp. Low-saturation blue-white light is deliberately excluded so
     * the meteor and its corona retain the source image's temperature.
     */
    float maximum = max(texel.r, max(texel.g, texel.b));
    float minimum = min(texel.r, min(texel.g, texel.b));
    float saturation = maximum - minimum;
    float redLead = texel.r - max(texel.g, texel.b);
    float warmMask = smoothstep(0.025, 0.18, redLead) * smoothstep(0.06, 0.32, saturation);
    float warmTone = pow(clamp(dot(texel.rgb, vec3(0.28, 0.58, 0.14)) * 1.42, 0.0, 1.0), 0.72);
    texel.rgb = mix(texel.rgb, duneRamp(warmTone), warmMask);

    /*
     * ⚠️ LUMINANCE BECOMES ALPHA.
     * Additive blending already drops the black background, but without this
     * the dark half of the plate still lays a faint grey rectangle over the
     * starfield on GPUs that round the blend differently.
     */
    float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(texel.rgb, lum);
  }
`

const NEBULA_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    /*
     * This is not a drawn beam. It samples only the blue-white light already
     * present in the supplied plate, then advances alternating packets through
     * that texture along the ball's existing diagonal wake.
     */
    float beamAxis = 0.286 + vUv.x * 0.67;
    float beamWidth = mix(0.085, 0.028, smoothstep(0.08, 0.84, vUv.x));
    float distanceToBeam = abs(vUv.y - beamAxis) / beamWidth;
    float beamMask = exp(-distanceToBeam * distanceToBeam * 1.65);
    beamMask *= smoothstep(0.03, 0.2, vUv.x);
    beamMask *= 1.0 - smoothstep(0.86, 0.93, vUv.x);

    float flutter = sin(uTime * 1.15 + vUv.x * 17.0) * 0.0028;
    vec2 flowingUv = vUv + vec2(flutter, flutter * 0.67);
    vec4 source = texture2D(uMap, flowingUv);
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    float coolLead = source.b - source.r * 0.52;
    float existingLight = clamp(
      smoothstep(0.04, 0.32, coolLead) + smoothstep(0.66, 0.98, luminance),
      0.0,
      1.0
    );

    float travel = (0.825 - vUv.x) * 48.0 - uTime * 4.6;
    float shootingPacket = pow(0.5 + 0.5 * sin(travel), 7.0);
    float secondaryPacket = pow(0.5 + 0.5 * sin(travel * 0.47 + 1.8), 10.0);
    float nebulaBreath = 0.72 + 0.28 * sin(uTime * 0.82 + vUv.x * 5.0);
    float energy = 0.12 + shootingPacket * 0.7 + secondaryPacket * 0.38;
    float alpha = beamMask * existingLight * energy * nebulaBreath;

    gl_FragColor = vec4(source.rgb * (0.72 + energy), alpha);
  }
`

const ORB_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ORB_FRAGMENT = /* glsl */ `
  void main() {
    /*
     * ⚠️ FLAT BLACK. NO RIM. THE RIM WAS THE FLOATING RING.
     *
     * This shaded a fresnel edge — bright where the sphere turned away from
     * the camera. Against the hand that reads as a lit hole, but most of its
     * circumference sits on empty starfield, where the black core is invisible
     * and only the glowing edge survives. What you see is a hoop hanging in
     * space with nothing inside it.
     *
     * The object still has to exist. The singularity is painted into the plate
     * as a BLACK disc and the hand is composited additively, which drops black
     * — so deleting this would not leave the artwork's hole behind, it would
     * leave nothing, and the hand would reach toward empty sky. Alpha stays 1:
     * the one job a hole has is to occlude the stars behind it.
     *
     * ⚠️ NOT QUITE BLACK — THIS IS THE DARK LIMB.
     * At pure black the body vanished into the sky and only the crescent
     * painted into the plate survived, so the sphere read as a sliver rather
     * than as a full one. Lifting it a few percent lets the WHOLE disc
     * silhouette behind that crescent, the way earthshine shows the unlit part
     * of a moon. It is deliberately flat: any falloff toward the edge is a
     * fresnel rim, and a rim on a body this small is the floating hoop that
     * was removed.
     */
    gl_FragColor = vec4(0.055, 0.062, 0.085, 1.0);
  }
`

export function SingularityHeroScene({
  children,
  className = '',
  ...props
}: SingularityHeroSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fallbackRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const fallback = fallbackRef.current
    if (!host) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      /*
       * ⚠️ THE PLATE STAYS ON SCREEN IF WEBGL IS UNAVAILABLE.
       * Software renderers, blocklisted GPUs and hardened browsers all fail
       * here. A hero that renders nothing is worse than one that renders a
       * picture, so the <img> underneath is simply left visible.
       */
      if (fallback) fallback.style.opacity = '1'
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.className = 'absolute inset-0 size-full'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400)
    camera.position.z = CAMERA_DISTANCE

    // ── starfield ────────────────────────────────────────────────────────────
    /*
     * Real points spread through z. Depth is the whole reason this exists: a
     * painted starfield slides with the hand, so it reads as wallpaper. These
     * sit behind it and parallax against it when the camera shifts.
     */
    const STAR_COUNT = 2600
    const starPositions = new Float32Array(STAR_COUNT * 3)
    const starSizes = new Float32Array(STAR_COUNT)
    let starSeed = 0x2f6b1d
    const rand = () => {
      starSeed = (starSeed * 1664525 + 1013904223) >>> 0
      return starSeed / 4294967296
    }
    for (let i = 0; i < STAR_COUNT; i += 1) {
      starPositions[i * 3] = (rand() - 0.5) * 90
      starPositions[i * 3 + 1] = (rand() - 0.5) * 55
      starPositions[i * 3 + 2] = -4 - rand() * 70
      starSizes[i] = 0.5 + rand() * 2.6
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1))
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        uniform float uTime;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.55 + 0.45 * sin(uTime * 1.1 + position.x * 0.7 + position.y * 0.4);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (150.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTwinkle;
        void main() {
          // Round and soft-edged. Square stars are the giveaway of an
          // untouched gl_PointCoord sprite.
          float d = length(gl_PointCoord - 0.5);
          float alpha = smoothstep(0.5, 0.0, d) * vTwinkle;
          gl_FragColor = vec4(vec3(0.78, 0.86, 1.0), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)

    // ── the hand ─────────────────────────────────────────────────────────────
    const loader = new THREE.TextureLoader()
    const texture = loader.load('/leadengine/hero-reaching-singularity-dune.png', () => {
      if (fallback) fallback.style.opacity = '0'
    })
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false

    const handGeometry = new THREE.PlaneGeometry(1, 1, 96, 54)
    const handMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uTime: { value: 0 },
      },
      vertexShader: HAND_VERTEX,
      fragmentShader: HAND_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const hand = new THREE.Mesh(handGeometry, handMaterial)
    scene.add(hand)

    // ── the moving light already painted into the plate ────────────────────
    const nebulaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uTime: { value: 0 },
      },
      vertexShader: HAND_VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const nebula = new THREE.Mesh(handGeometry, nebulaMaterial)
    scene.add(nebula)

    // ── the singularity ──────────────────────────────────────────────────────
    const orbMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: ORB_VERTEX,
      fragmentShader: ORB_FRAGMENT,
      /*
       * `transparent` with alpha 1 rather than an opaque material: three.js
       * draws opaque meshes FIRST, so an opaque orb would be painted over by
       * the additive hand and starfield and stop being a hole at all. Marking
       * it transparent moves it into the later pass, where `renderOrder` puts
       * it last of the three.
       */
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), orbMaterial)
    scene.add(orb)

    /*
     * ⚠️ THE SILHOUETTE IS DRAWN BEFORE THE HAND, NOT AFTER IT.
     *
     * It used to be last, sitting on top of the plate — so the crescent
     * painted around the hole was buried under it and the luna read as an
     * object stuck ON the artwork. Behind the hand, the additive plate is
     * composited over it: at the hole the texture is black and adds nothing,
     * so the silhouette shows through; the ring of light just outside the
     * hole is painted over it exactly as drawn. The result is a body seen
     * BEHIND its own corona.
     */
    stars.renderOrder = 0
    orb.renderOrder = 1
    hand.renderOrder = 2
    nebula.renderOrder = 3

    // ── state ────────────────────────────────────────────────────────────────
    let width = 1
    let height = 1
    let layout = sceneLayout(width, height)
    let frame = 0
    let visible = true
    let lastTime = performance.now()

    let pointerNormX = 0
    let pointerNormY = 0
    let cameraX = 0
    let cameraY = 0

    const orbHost = { x: 0, y: 0 }
    /** The hole's rest position and the plane scale. */
    const orbBase = new THREE.Vector3()
    /** The hand's rest position, for the damping below. */
    const handBase = new THREE.Vector3()

    /*
     * ⚠️ THE HAND FOLLOWS THE CAMERA PART OF THE WAY, RATHER THAN THE CAMERA
     * PANNING LESS.
     *
     * Its drift and the starfield's parallax come from the same camera pan, so
     * simply reducing the pan would have damped both and flattened the depth
     * that makes the field read as 3D. Moving the hand WITH the camera by this
     * fraction cancels most of its own travel and leaves every star untouched.
     * 0 = full drift, 1 = the hand is nailed to the viewport.
     */
    const HAND_DRIFT_DAMPING = 0.55

    const place = () => {
      const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan((CAMERA_FOV * Math.PI) / 360)
      const worldPerPixel = visibleHeight / height

      hand.scale.set(
        layout.imageWidth * worldPerPixel,
        layout.imageHeight * worldPerPixel,
        1,
      )
      nebula.scale.copy(hand.scale)

      // Host pixels → world: origin at the frame centre, y flipped.
      const cx = layout.imageX + layout.imageWidth / 2
      const cy = layout.imageY + layout.imageHeight / 2
      handBase.set(
        (cx - width / 2) * worldPerPixel,
        -(cy - height / 2) * worldPerPixel,
        0,
      )
      hand.position.copy(handBase)
      nebula.position.copy(handBase)

      orbHost.x = layout.imageX + layout.imageWidth * ORB_SOURCE_X
      orbHost.y = layout.imageY + layout.imageHeight * ORB_SOURCE_Y
      /*
       * Expressed as a fraction of the plate, so it stays welded to the
       * artwork at every viewport; a fixed pixel radius drifts off the hole as
       * soon as the image is scaled.
       */
      orb.scale.setScalar(layout.imageWidth * HOLE_RADIUS * worldPerPixel)
      orbBase.set(
        (orbHost.x - width / 2) * worldPerPixel,
        -(orbHost.y - height / 2) * worldPerPixel,
        -0.05,
      )
      orb.position.copy(orbBase)
    }

    const resize = () => {
      const bounds = host.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      layout = sceneLayout(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      place()
    }

    const move = (event: PointerEvent) => {
      if (!finePointer.matches || layout.narrow || reducedMotion.matches) return
      const bounds = host.getBoundingClientRect()
      pointerNormX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
      pointerNormY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
    }

    const leave = () => {
      pointerNormX = 0
      pointerNormY = 0
    }

    const draw = (time: number) => {
      const delta = Math.min(40, time - lastTime)
      lastTime = time
      const motion = reducedMotion.matches ? 0 : 1
      const seconds = time / 1000
      const smoothing = 1 - Math.pow(0.001, delta / 1000)

      /*
       * ⚠️ THE RING DOES NOT TRAVEL. It sits on the singularity painted into
       * the plate and stays there. It previously ran a meteor cycle with a
       * trail of ghosts behind it, which read as a SECOND ring crossing the
       * frame — the plate already has one, and two is one too many.
       */
      starMaterial.uniforms.uTime.value = seconds * motion
      nebulaMaterial.uniforms.uTime.value = seconds * motion

      /*
       * The CAMERA moves, not the objects. That is what makes the starfield
       * parallax: points at different depths shift by different amounts on
       * their own, which no amount of sliding a flat layer imitates.
       */
      cameraX += (pointerNormX - cameraX) * smoothing
      cameraY += (pointerNormY - cameraY) * smoothing
      camera.position.x = cameraX * 0.32 * motion
      camera.position.y = -cameraY * 0.2 * motion

      // The hand rides along with the camera, cancelling most of its drift.
      hand.position.x = handBase.x + camera.position.x * HAND_DRIFT_DAMPING
      hand.position.y = handBase.y + camera.position.y * HAND_DRIFT_DAMPING
      nebula.position.copy(hand.position)
      orb.position.x = orbBase.x + camera.position.x * HAND_DRIFT_DAMPING
      orb.position.y = orbBase.y + camera.position.y * HAND_DRIFT_DAMPING

      /*
       * ⚠️ NO `lookAt` — THAT WAS THE HAND'S EXPAND AND CONTRACT.
       *
       * The mesh is never scaled; `hand.scale` is set once in `place()` and
       * never touched again. The swelling came from the CAMERA: translating it
       * and then aiming it back at the origin tilts the view, and the hand
       * sits off-centre to the right, so its projection foreshortened as the
       * cursor moved and it appeared to breathe.
       *
       * Dropping the rotation leaves a pure lateral translation, which shifts
       * everything by an amount proportional to its depth and changes nobody's
       * apparent size. The starfield keeps its parallax — that comes from the
       * depth spread, not from the aim — and the hand simply holds still.
       */

      stars.rotation.z = seconds * 0.004 * motion

      renderer.render(scene, camera)

      if (visible && !reducedMotion.matches) {
        frame = window.requestAnimationFrame(draw)
      }
    }

    const render = () => {
      window.cancelAnimationFrame(frame)
      lastTime = performance.now()
      frame = window.requestAnimationFrame(draw)
    }

    const observer = new ResizeObserver(() => {
      resize()
      render()
    })
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === 'visible'
      if (visible) render()
      else window.cancelAnimationFrame(frame)
    })
    const visibilityChange = () => {
      visible =
        document.visibilityState === 'visible' && host.getBoundingClientRect().bottom > 0
      if (visible) render()
      else window.cancelAnimationFrame(frame)
    }
    const motionChange = () => render()

    resize()
    observer.observe(host)
    visibilityObserver.observe(host)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    document.addEventListener('visibilitychange', visibilityChange)
    reducedMotion.addEventListener('change', motionChange)
    render()

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      visibilityObserver.disconnect()
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', visibilityChange)
      reducedMotion.removeEventListener('change', motionChange)

      /*
       * Every GPU resource is released explicitly. React remounts effects in
       * development, and a browser hard-caps live WebGL contexts at around 16
       * before it starts silently dropping the oldest one.
       */
      starGeometry.dispose()
      starMaterial.dispose()
      handGeometry.dispose()
      handMaterial.dispose()
      nebulaMaterial.dispose()
      orb.geometry.dispose()
      orbMaterial.dispose()
      texture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={`relative isolate h-full w-full overflow-hidden bg-black ${className}`}
      {...props}
    >
      {/*
        Held underneath as the first paint and the WebGL fallback. Faded out
        once the texture reaches the GPU, and left visible for good if the
        context could not be created at all.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={fallbackRef}
        src="/leadengine/hero-reaching-singularity-dune.png"
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 h-full w-auto min-w-full max-w-none -translate-x-1/2 -translate-y-1/2 select-none object-cover transition-opacity duration-500"
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.86)_31%,rgba(0,0,0,0.28)_58%,rgba(0,0,0,0.02)_78%)] md:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.97)_0%,rgba(0,0,0,0.9)_32%,rgba(0,0,0,0.28)_55%,rgba(0,0,0,0.04)_78%)] md:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_22%,transparent_0%,transparent_27%,rgba(0,0,0,0.22)_62%,rgba(0,0,0,0.66)_100%)]"
      />

      {children ? <div className="relative z-10 h-full w-full">{children}</div> : null}
    </div>
  )
}
