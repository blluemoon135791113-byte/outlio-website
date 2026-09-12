"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CenteredMasthead from "./variants/CenteredMasthead";
import EditorialOffset from "./variants/EditorialOffset";
import SplitTopRail from "./variants/SplitTopRail";
import styles from "./PrototypePicker.module.css";

const variants = [
  { name: "Right Editorial" },
  { name: "Right Compact" },
  { name: "Right Inset" },
];

const variantComponents = [EditorialOffset, CenteredMasthead, SplitTopRail];

export default function PrototypePicker() {
  const [current, setCurrent] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setActive = useCallback((index: number) => {
    if (index < 0 || index >= variants.length) return;
    setCurrent(index);
    setMountKey((key) => key + 1);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(index + 1));
    window.history.replaceState(null, "", url);
  }, []);

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[current];
    const highlight = highlightRef.current;
    if (!item || !highlight) return;
    highlight.style.width = `${item.offsetWidth}px`;
    highlight.style.transform = `translateX(${item.offsetLeft}px)`;
  }, [current]);

  useEffect(() => {
    const requested = Number.parseInt(
      new URLSearchParams(window.location.search).get("v") ?? "1",
      10,
    );
    const initial = Math.min(variants.length - 1, Math.max(0, requested - 1));
    const frame = window.requestAnimationFrame(() => setCurrent(initial));
    let innerFrame = 0;
    const readyFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        pickerRef.current?.setAttribute("data-ready", "");
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(readyFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= variants.length) setActive(number - 1);
      else if (event.key === "ArrowRight") setActive((current + 1) % variants.length);
      else if (event.key === "ArrowLeft") {
        setActive((current - 1 + variants.length) % variants.length);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, setActive]);

  useLayoutEffect(() => {
    moveHighlight();
  }, [moveHighlight]);

  useEffect(() => {
    window.addEventListener("resize", moveHighlight);
    return () => window.removeEventListener("resize", moveHighlight);
  }, [moveHighlight]);

  const Variant = variantComponents[current];

  return (
    <>
      <div key={mountKey}>
        <Variant />
      </div>

      <nav ref={pickerRef} className={styles["proto-picker"]} aria-label="Prototype variants">
        <span ref={highlightRef} className={styles["proto-picker-highlight"]} aria-hidden="true" />
        {variants.map((variant, index) => (
          <button
            key={variant.name}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            className={styles["proto-picker-item"]}
            data-active={index === current ? "" : undefined}
            aria-current={index === current ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  );
}
