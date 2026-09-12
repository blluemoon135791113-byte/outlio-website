import Image from "next/image";
import Nav from "@/app/components/Nav";
import FloatingDotsCta from "@/components/ui/floating-dots-cta";
import styles from "./HeroSample.module.css";

export type HeroSampleLayout = "editorial" | "centered" | "split";

export default function HeroSample({ layout }: { layout: HeroSampleLayout }) {
  return (
    <main className={`${styles.hero} ${styles[layout]}`}>
      <Image
        className={styles.background}
        src="/hero/hero-sand-texture.png"
        alt=""
        fill
        sizes="100vw"
        priority
      />

      <Nav surface="agency" />

      <div className={styles.artwork} aria-hidden="true">
        <Image
          src="/hero/reference-watercolor-system-centered-natural-wrist.png"
          alt=""
          width={2172}
          height={941}
          sizes="75vw"
          priority
        />
      </div>

      <div className={styles.copyCluster}>
        <h1 className={styles.title}>Building GTM Sales Systems</h1>
        <p className={styles.description}>
          Infrastructure to get any data, run agentic workflows, and launch GTM plays.
        </p>
      </div>

      <div className={styles.cta}>
        <FloatingDotsCta label="Book a Discovery" />
      </div>
    </main>
  );
}
