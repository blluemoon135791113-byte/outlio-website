import Image from "next/image";
import LaunchpadSlider from "./LaunchpadSlider";
import LaunchpadRocket from "./LaunchpadRocket";
import styles from "./SalesStrategies.module.css";

/**
 * "Building on your Progress" — a continuation of the Use Modes / Tech section
 * (same ivory + canvas-texture ground). Three module cards; the titles are real,
 * the descriptions and the visual panels are placeholder slots for content added
 * later. The scaffolding inside each visual is generic, not a real dashboard.
 */
export default function SalesStrategies() {
  return (
    <section className={styles.section} aria-label="Building on your progress">
      <div className={styles.inner}>
        <div className={styles.intro}>
          <h2 className={styles.heading}>Building on your Progress</h2>
          <p className={styles.subtitle}>
            Outlio has helped its clients through a number of different Inbound and Outbound sales strategies.
          </p>
        </div>

        <div className={styles.cards}>
          {/* Module 1 — Outbound through Email: the extracted composer visual in
              the slot; the title and description are the card's own (code). */}
          <article className={styles.card}>
            <div className={`${styles.viz} ${styles.vizPhoto}`}>
              <Image
                src="/tech/outbound-email-sand.png"
                alt="An Outlio Campaign Email composer personalizing an outbound message with variables pulled from an Acme AI account record"
                fill
                quality={95}
                className={styles.photo}
                sizes="(min-width: 760px) 24rem, 92vw"
              />
            </div>
            <p className={styles.cardDesc}>
              We research and email best-fit accounts, then qualify the responses. Target a 15%+
              reply rate, 8–12 booked demos, and 3–5 new sales opportunities per campaign.
            </p>
          </article>

          {/* Module 2 (secondary) — the calendar comparison lives here now */}
          <article className={styles.card}>
            <div className={`${styles.viz} ${styles.vizPhoto}`}>
              <LaunchpadSlider />
            </div>
            <p className={styles.cardDesc}>
              We qualify social interest, book the right buyers, and follow up before each call.
              Target 10–15 booked meetings a month, 75%+ attendance, and 3–5 proposals.
            </p>
          </article>

          {/* Module 3 — Launchpad: the reference 3D sequence fills the visual. */}
          <article className={styles.card}>
            <div className={`${styles.viz} ${styles.vizPhoto} ${styles.vizRocket}`}>
              <LaunchpadRocket />
            </div>
            <p className={styles.cardDesc}>
              Launchpad algorithmically distributes your launch or demo video beyond its first post.
              Target 100%+ more reach, 25–35% of viewers watching to the end, and 50+ demo-page visits.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
