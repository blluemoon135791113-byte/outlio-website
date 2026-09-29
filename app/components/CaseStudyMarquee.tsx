import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./CaseStudyMarquee.module.css";

/**
 * A transparent, continuously-scrolling strip of the brands Outlio has driven
 * results for — the same mechanic as the qomplement hero ticker: a horizontal
 * track of logos, duplicated once so it can loop seamlessly under a constant
 * linear translate, with the ends dissolved by an edge-fade mask.
 *
 * The logos are single-ink monochrome marks in the heading ink (--ink). Four are
 * pre-rendered PNG silhouettes (see public/clients/silhouette/*); CopyBoard and
 * EE intellisuite are recreated inline-SVG lockups so their ink is `currentColor`
 * off `--ink` — an exact tone match that tracks the token — rather than a colour
 * frozen into pixels. Swap in official silhouette PNGs if any arrive.
 *
 * Every mark is normalised to the SAME HEIGHT by the stylesheet (not a fixed
 * width), so a wide wordmark and a square icon read as one consistent size, with
 * an equal gap between each. The second copy is aria-hidden so a screen reader
 * hears each brand once.
 */
type Mark =
  | { kind: "img"; key: string; src: string; alt: string; width: number; height: number }
  | { kind: "svg"; key: string; alt: string; render: (decorative: boolean) => ReactNode };

const MARKS: readonly Mark[] = [
  { kind: "img", key: "addx", src: "/clients/silhouette/addx.png", alt: "Addx Studio", width: 163, height: 44 },
  { kind: "img", key: "clicklabs", src: "/clients/silhouette/clicklabs.png", alt: "Click Labs", width: 600, height: 600 },
  { kind: "img", key: "knowledgecity", src: "/clients/silhouette/knowledgecity.png", alt: "Knowledge City", width: 57, height: 57 },
  { kind: "img", key: "motionisr", src: "/clients/silhouette/motionisr.png", alt: "Motionisr", width: 160, height: 185 },
  { kind: "svg", key: "copyboard", alt: "CopyBoard", render: (d) => <CopyBoardMark decorative={d} /> },
  { kind: "svg", key: "eeintellisuite", alt: "EE intellisuite", render: (d) => <EeIntellisuiteMark decorative={d} /> },
] as const;

/**
 * CopyBoard, a single-ink lockup: a filled ink badge whose "C" ring and accent
 * dot are knocked out via a luminance mask (so the hero shows through, exactly as
 * the baked silhouettes do), beside the wordmark. `currentColor` is set to `--ink`
 * by the wrapper, so both halves match the other marks' tone.
 */
function CopyBoardMark({ decorative = false }: { decorative?: boolean }) {
  return (
    <svg
      className={styles.logo}
      width={556}
      height={120}
      viewBox="0 0 556 120"
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : "CopyBoard"}
      aria-hidden={decorative || undefined}
      style={{ color: "var(--ink)" }}
    >
      <defs>
        <mask id="copyboard-badge-cut">
          {/* Kept ink = white; knocked-out (hero shows through) = black. */}
          <circle cx={60} cy={60} r={54} fill="#fff" />
          {/* The "C": a thick ring open to the right. */}
          <path
            d="M 79 39 A 27 27 0 1 0 79 81"
            fill="none"
            stroke="#000"
            strokeWidth={13}
            strokeLinecap="round"
          />
          {/* Accent dot at the mouth of the C. */}
          <circle cx={83} cy={35} r={5} fill="#000" />
        </mask>
      </defs>
      <circle cx={60} cy={60} r={54} fill="currentColor" mask="url(#copyboard-badge-cut)" />
      <text
        x={132}
        y={62}
        fill="currentColor"
        fontFamily="var(--font-dm-sans), var(--font-inter), system-ui, sans-serif"
        fontSize={62}
        fontWeight={700}
        letterSpacing={-2}
        dominantBaseline="central"
      >
        CopyBoard
      </text>
    </svg>
  );
}

/**
 * EE intellisuite, a single-ink lockup: a line-art pie/segment mark with one
 * exploded wedge, "EE" set bold beside it, and "intellisuite" beneath — all in
 * `currentColor` off `--ink`. The icon is stroked (not filled) to read as the
 * original's outlined chart at strip scale.
 */
function EeIntellisuiteMark({ decorative = false }: { decorative?: boolean }) {
  return (
    <svg
      className={styles.logo}
      width={392}
      height={208}
      viewBox="0 0 392 208"
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : "EE intellisuite"}
      aria-hidden={decorative || undefined}
      style={{ color: "var(--ink)" }}
    >
      <g fill="none" stroke="currentColor" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round">
        {/* Pie body: the disc with a lower-right slice removed (that slice sits
            exploded beside it), and one internal divider marking a segment. */}
        <path d="M 62 58 L 110.3 70.9 A 50 50 0 1 0 79.1 105 Z" />
        <path d="M 62 58 L 87 14.7" />
        {/* The exploded slice, nudged out along its own bisector. */}
        <path d="M 68.6 64.1 L 116.9 77 A 50 50 0 0 1 85.7 111.1 Z" />
      </g>
      <text
        x={150}
        y={64}
        fill="currentColor"
        fontFamily="var(--font-dm-sans), var(--font-inter), system-ui, sans-serif"
        fontSize={104}
        fontWeight={800}
        letterSpacing={-3}
        dominantBaseline="central"
      >
        EE
      </text>
      <text
        x={8}
        y={172}
        fill="currentColor"
        fontFamily="var(--font-dm-sans), var(--font-inter), system-ui, sans-serif"
        fontSize={70}
        fontWeight={500}
        letterSpacing={-2}
        dominantBaseline="central"
      >
        intellisuite
      </text>
    </svg>
  );
}

export default function CaseStudyMarquee() {
  const renderMark = (mark: Mark, decorative: boolean): ReactNode => {
    if (mark.kind === "svg") return mark.render(decorative);
    return (
      <Image
        src={mark.src}
        alt={decorative ? "" : mark.alt}
        width={mark.width}
        height={mark.height}
        className={styles.logo}
        unoptimized
      />
    );
  };

  const copy = (prefix: string, decorative: boolean) =>
    MARKS.map((mark) => (
      <li key={`${prefix}-${mark.key}`} className={styles.item} aria-hidden={decorative || undefined}>
        {renderMark(mark, decorative)}
      </li>
    ));

  return (
    <div className={styles.wrap} aria-label="Brands Outlio has driven results for">
      <ul className={styles.track}>
        {copy("a", false)}
        {copy("b", true)}
      </ul>
    </div>
  );
}
