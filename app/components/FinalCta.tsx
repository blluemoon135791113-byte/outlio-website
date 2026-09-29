import Image from "next/image";
import { CALENDLY_URL } from "../lib/constants";
import styles from "./FinalCta.module.css";

export default function FinalCta() {
  return (
    <section id="book" className={styles.section}>
      <div className={styles.card}>
        <Image
          className={styles.artwork}
          src="/cta/desert-arc-clean.png"
          alt=""
          aria-hidden="true"
          width="1696"
          height="960"
          loading="lazy"
          decoding="async"
          unoptimized
        />
        <div className={styles.copy}>
          <h2>You&apos;ve read enough.</h2>
        </div>
        <a className={styles.cta} href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
          <span>Book a Call</span>
          <span className={styles.arrow} aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
