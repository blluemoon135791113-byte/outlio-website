import Image from "next/image";
import FloatingDotsCta from "@/components/ui/floating-dots-cta";
import { CALENDLY_URL } from "../lib/constants";
import styles from "./InteractiveGtmHero.module.css";

export default function InteractiveGtmHero() {
  return (
    <section className={styles.hero} aria-labelledby="gtm-hero-title">
      <div className={styles.artwork}>
        <div className={styles.backgroundFrame} aria-hidden="true">
          <Image
            className={styles.backgroundImage}
            src="/hero/hero-sand-texture.png"
            alt=""
            fill
            sizes="100vw"
            preload
          />
        </div>
        <div className={styles.imageFrame}>
          <Image
            className={styles.image}
            src="/hero/reference-watercolor-original-cutout.png"
            alt="A watercolor-painted hand holding a blue sphere beneath a faceted blue object"
            width={1187}
            height={625}
            sizes="100vw"
            preload
          />
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.copyCluster}>
          <h1 id="gtm-hero-title" className={styles.title}>
            Building GTM Sales Systems
          </h1>
          <p className={styles.description}>
            Infrastructure to get any data, run agentic workflows, and launch GTM plays.
          </p>
        </div>

        <form
          className={styles.ctaForm}
          action={CALENDLY_URL}
          method="get"
          target="_blank"
        >
          <FloatingDotsCta label="Book a Discovery" type="submit" />
        </form>
      </div>
    </section>
  );
}
