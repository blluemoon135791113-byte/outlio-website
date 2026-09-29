"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./TeamAccordion.module.css";

const team = [
  {
    id: "husnain",
    name: "Husnain",
    role: "Founder",
    photo: "/team/husnain.jpg",
    linkedin: "https://www.linkedin.com/in/husnain-rafiq-343179290/",
    x: "https://x.com/husnain_rfq",
  },
  {
    id: "saboor",
    name: "Saboor",
    role: "Co-Founder",
    photo: "/team/saboor.png",
    linkedin: "https://www.linkedin.com/in/abdulsaboor2004/",
    x: "https://x.com/abdulsaboor2004",
  },
  {
    id: "saad",
    name: "Saad",
    role: "Operations Manager",
    photo: "/team/saad.png",
    linkedin: "https://www.linkedin.com/in/saad-rafiq-a57a62335/",
    x: "https://x.com/SaadRaf22",
  },
] as const;

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.1 3.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM3.5 8.5h3.2V21H3.5V8.5Zm5.1 0h3.1v1.7h.1a3.5 3.5 0 0 1 3.2-1.9c3.4 0 4 2.2 4 5V21h-3.2v-6.8c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H8.6V8.5Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17.9 2H21l-6.8 7.8L22.2 22h-6.3L11 14.7 4.7 22H1.5l7.3-8.5L1.1 2h6.5l4.5 6.8L17.9 2Zm-1.1 18h1.7L6.7 3.9H4.8L16.8 20Z" />
    </svg>
  );
}

export default function TeamAccordion() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <section id="team" className={styles.section} aria-labelledby="team-heading">
      <div className={styles.inner}>
        <h2 id="team-heading" className={styles.heading}>The Guys at the Back</h2>
        <div className={`${styles.accordion} ${active ? styles.hasActive : ""}`}>
          {team.map((person) => {
            const expanded = active === person.id;
            return (
              <article
                key={person.id}
                className={`${styles.person} ${expanded ? styles.active : ""}`}
                data-person={person.id}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") setActive(person.id);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== "touch") setActive(null);
                }}
                onFocus={() => setActive(person.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
                }}
              >
                <Image
                  src={person.photo}
                  alt={`${person.name}, ${person.role} at Outlio`}
                  fill
                  sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 480px"
                  className={styles.photo}
                />
                <button
                  type="button"
                  className={styles.hitArea}
                  aria-label={`Show ${person.name} social links`}
                  aria-expanded={expanded}
                  onClick={() => {
                    if (window.matchMedia("(hover: none)").matches) {
                      setActive(person.id);
                    }
                  }}
                />
                <div className={styles.caption}>
                  <div className={styles.identity}>
                    <h3>{person.name}</h3>
                    <p>{person.role}</p>
                  </div>
                  <div className={styles.socials} aria-hidden={!expanded}>
                    <a href={person.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} on LinkedIn`} tabIndex={expanded ? 0 : -1}>
                      <LinkedInIcon />
                    </a>
                    <a href={person.x} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} on X`} tabIndex={expanded ? 0 : -1}>
                      <XIcon />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
