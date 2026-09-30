"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./UseModes.module.css";

const MODES = ["Tech / SaaS", "Creative Agencies", "Enterprise"] as const;
type Mode = (typeof MODES)[number];

const DEFAULT_MODE: Mode = "Creative Agencies";
// Modes with real content today. Others fall back to the default view + a hint.
const BUILT: Partial<Record<Mode, boolean>> = { "Creative Agencies": true, "Tech / SaaS": true };

/**
 * Page-2 "Use modes" section. The "Outlio For" selector switches the section
 * between per-audience views:
 *   - Creative Agencies → "Afflatus" card (placeholder video, public/afflatus/placeholder.mp4)
 *   - Tech / SaaS       → "Informatik" card, the floating Macintosh render on muted teal
 * Enterprise has no content yet, so it shows the default view with a "coming soon" hint.
 * The section ground matches the hero's ivory sand texture for continuity.
 */
export default function UseModes() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeMode: Mode = BUILT[mode] ? mode : DEFAULT_MODE;
  const comingSoon = !BUILT[mode];

  return (
    <section
      className={`${styles.section} ${activeMode === "Tech / SaaS" ? styles.bgTech : styles.bgAgency}`}
      aria-label="Outlio use modes"
    >
      <div className={styles.grid}>
        {/* LEFT */}
        <div className={styles.left}>
          <div className={styles.selector} ref={selectorRef}>
            <span className={styles.slabel}>Outlio For</span>
            <div className={styles.triggerWrap}>
              <button
                type="button"
                className={styles.trigger}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <span>{mode}</span>
                <svg
                  className={styles.chev}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {open && (
                <div className={styles.menu} role="listbox" aria-label="Outlio For">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={styles.opt}
                      role="option"
                      aria-selected={m === mode}
                      onClick={() => {
                        setMode(m);
                        setOpen(false);
                      }}
                    >
                      {m}
                      <svg
                        className={styles.tick}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {activeMode === "Tech / SaaS" ? (
            <>
              <h2 className={styles.h2}>The Sales Infrastructure for your Launch</h2>
              <div className={styles.description}>
                <p>
                  Outlio turns a defined ICP into a working sales pipeline. Target-account research
                  identifies buying teams; personalized email, LinkedIn, and call sequences open
                  conversations. Responses are qualified before they reach your calendar. Booked
                  demos, SQLs, and demo-to-opportunity conversion show which segments and messages
                  create sales opportunities.
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 className={styles.h2}>
                Your Tools.
                <br />
                Our Canvas.
              </h2>
              <div className={styles.description}>
                <p>
                  Your team should spend its time making the work, not searching for the next project.
                  Companies with a need for your kind of creative work are researched and contacted with care.
                  Scope, budget, and timing are checked before a conversation reaches you, so you can focus on briefs that fit.
                </p>
              </div>
            </>
          )}

          {comingSoon && (
            <p className={styles.hint}>
              <span className={styles.dot} aria-hidden="true" /> Showing {DEFAULT_MODE} — other modes coming soon.
            </p>
          )}
        </div>

        {/* RIGHT: card switches with the selected mode */}
        {activeMode === "Tech / SaaS" ? (
          <div className={`${styles.card} ${styles.cardTeal}`}>
            <div className={styles.macFloat}>
              <Image
                src="/tech/informatik-dark-teal.png"
                alt="A retro Macintosh — monitor, drive, keyboard, mouse and CDs"
                fill
                quality={95}
                className={styles.macImg}
                sizes="(min-width: 768px) 50vw, 92vw"
              />
            </div>
            <div className={styles.cardBody}>
              <h3 className={`${styles.h3} ${styles.h3Teal}`}>Informatik</h3>
            </div>
          </div>
        ) : (
          <div className={styles.card}>
            <div className={styles.cardMedia} aria-hidden="true" />
            <video
              className={styles.cardVideo}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
              src="/afflatus/placeholder.mp4"
            />
            <div className={styles.cardOverlay} aria-hidden="true" />
            <div className={styles.cardBody}>
              <h3 className={styles.h3}>Afflatus</h3>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
