import { FanArt } from './FanArt'
import styles from './AuthHero.module.css'

/**
 * The brand panel beside every auth form — the fan artwork, as native vector.
 *
 * The panel fills the grid cell, which is stretched to the form's height, so
 * the art's visible height matches the form's text + fields exactly. The SVG is
 * `aria-hidden` (decorative); the form carries the page's meaning.
 */
export function AuthHero() {
  return (
    <div className={styles.panel}>
      <FanArt className={styles.art} />
    </div>
  )
}
