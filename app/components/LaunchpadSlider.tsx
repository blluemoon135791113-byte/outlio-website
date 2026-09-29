"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import styles from "./LaunchpadSlider.module.css";

/**
 * Launchpad Architecture — an interactive before/after comparison slider.
 * Drag the divider to reveal "Scatter" (a sparse, low-signal week) on the left
 * and "Signal Only" (a week packed with real opportunities) on the right. The
 * two calendars share an identical grid so the divider clips seamlessly between
 * them, and each side's pill re-centres within its visible half.
 *
 * Original Outlio artwork: the calendar mark is generic, not a third-party logo.
 */

type Tone = "blue" | "green" | "purple" | "yellow" | "red" | "mute";
type Ev = { day: number; row: number; title: string; time: string; tone: Tone };

const DAYS = ["Sun 14", "Mon 15", "Tue 16", "Wed 17", "Thu 18", "Fri 19", "Sat 20"];
const TIMES = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM"];

// Both weeks span all seven days so the divider reveals a real transformation:
// drag left for the full "Signal Only" week, right for the sparse "Scatter" week.
// Colour maps to category — calls = blue, delivery = green, early-stage
// discussions = violet, proposals = red, customer work = amber, busywork = grey.
const SCATTER: Ev[] = [
  { day: 1, row: 1, title: "Research", time: "10:00 – 11:00 AM", tone: "mute" },
  { day: 3, row: 3, title: "CRM cleanup", time: "12:00 – 1:00 PM", tone: "mute" },
  { day: 5, row: 5, title: "Manual outreach", time: "2:00 – 3:00 PM", tone: "mute" },
];

const SIGNAL: Ev[] = [
  { day: 0, row: 1, title: "Discovery Call", time: "10:00 – 11:00 AM", tone: "blue" },
  { day: 1, row: 0, title: "Demo Call", time: "9:00 – 10:00 AM", tone: "blue" },
  { day: 2, row: 1, title: "PoC Discussion", time: "10:00 – 11:00 AM", tone: "purple" },
  { day: 2, row: 5, title: "Pilot Project", time: "2:00 – 3:00 PM", tone: "green" },
  { day: 3, row: 0, title: "Discovery Call", time: "9:00 – 10:00 AM", tone: "blue" },
  { day: 4, row: 1, title: "Proposal Review", time: "10:00 – 11:00 AM", tone: "red" },
  { day: 4, row: 4, title: "Customer Sync", time: "1:00 – 2:00 PM", tone: "yellow" },
  { day: 5, row: 0, title: "Demo Call", time: "9:00 – 10:00 AM", tone: "blue" },
  { day: 5, row: 5, title: "Discovery Call", time: "2:00 – 3:00 PM", tone: "blue" },
  { day: 6, row: 1, title: "Customer Sync", time: "10:00 – 11:00 AM", tone: "yellow" },
];

function Chevron({ dir, className }: { dir: "left" | "right"; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
    </svg>
  );
}

/** Generic calendar mark — original, deliberately not any product's logo. */
function CalendarMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
      <circle cx="8.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Calendar({ events }: { events: Ev[] }) {
  return (
    <div className={styles.cal}>
      <div className={styles.calHead}>
        <span className={styles.brand}>
          <CalendarMark />
          <span className={styles.range}>Feb 14 – Feb 20, 2027</span>
        </span>
      </div>
      <div className={styles.grid}>
        {DAYS.map((d, i) => (
          <div key={d} className={styles.dayHead} style={{ gridColumn: i + 2 }}>{d}</div>
        ))}
        {TIMES.map((t, r) => (
          <div key={t} className={styles.timeLabel} style={{ gridRow: r + 2 }}>{t}</div>
        ))}
        {TIMES.map((_, r) =>
          DAYS.map((_d, c) => (
            <div key={`${r}-${c}`} className={styles.cell} style={{ gridRow: r + 2, gridColumn: c + 2 }} />
          )),
        )}
        {events.map((e, i) => (
          <div
            key={i}
            className={`${styles.ev} ${styles[e.tone]} ${e.title === "Customer Sync" ? styles.evCompact : ""}`}
            style={{ gridColumn: e.day + 2, gridRow: e.row + 2 }}
          >
            <span className={`${styles.evTitle} ${e.title === "Customer Sync" ? styles.evTitleCompact : ""}`}>
              {e.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LaunchpadSlider() {
  const stageRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const posRef = useRef(48);
  const dragging = useRef(false);

  const setPos = (p: number) => {
    const clamped = Math.max(0, Math.min(100, p));
    posRef.current = clamped;
    stageRef.current?.style.setProperty("--pos", String(clamped));
    const h = handleRef.current;
    if (h) {
      h.setAttribute("aria-valuenow", String(Math.round(clamped)));
      h.dataset.edge = clamped <= 4 ? "left" : clamped >= 96 ? "right" : "mid";
    }
  };

  // Reveal-on-scroll: when the calendar first enters view, sweep the divider
  // from the sparse "Scatter" week across to rest, showing the transformation.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let played = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !played) {
            played = true;
            const state = { pos: 82 };
            setPos(82);
            gsap.to(state, {
              pos: 48,
              duration: 1.15,
              ease: "power3.out",
              delay: 0.15,
              onUpdate: () => setPos(state.pos),
            });
            io.disconnect();
          }
        }
      },
      { threshold: 0.45 },
    );
    io.observe(stage);
    return () => io.disconnect();
  }, []);

  const posFromX = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return posRef.current;
    return ((clientX - rect.left) / rect.width) * 100;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    stageRef.current?.setPointerCapture?.(e.pointerId);
    setPos(posFromX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos(posFromX(e.clientX));
  };
  const endDrag = (e: React.PointerEvent) => {
    dragging.current = false;
    stageRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { setPos(posRef.current - 4); e.preventDefault(); }
    else if (e.key === "ArrowRight") { setPos(posRef.current + 4); e.preventDefault(); }
    else if (e.key === "Home") { setPos(0); e.preventDefault(); }
    else if (e.key === "End") { setPos(100); e.preventDefault(); }
  };

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      style={{ ["--pos" as string]: 48 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* base: Signal (packed). Its label lives inside it, so the scatter panel
          wipes over it as the divider slides right. */}
      <div className={`${styles.panel} ${styles.signal}`}>
        <Calendar events={SIGNAL} />
        <span className={`${styles.pill} ${styles.pillSignal}`} aria-hidden="true">With Outlio</span>
      </div>

      {/* top: Scatter (sparse) — clipped to the left of the divider, so its label
          is wiped away with it as the divider slides left. */}
      <div className={`${styles.panel} ${styles.scatter}`} aria-hidden="true">
        <Calendar events={SCATTER} />
        <span className={`${styles.pill} ${styles.pillScatter}`} aria-hidden="true">Scatter</span>
      </div>

      <div className={styles.divider} aria-hidden="true" />
      <button
        ref={handleRef}
        type="button"
        className={styles.handle}
        data-edge="mid"
        role="slider"
        aria-label="Compare Scatter with Signal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={48}
        onKeyDown={onKeyDown}
      >
        <Chevron dir="left" className={styles.chevL} />
        <Chevron dir="right" className={styles.chevR} />
      </button>
    </div>
  );
}
