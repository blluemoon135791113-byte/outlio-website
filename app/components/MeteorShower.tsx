"use client";

import { useEffect, useRef } from "react";

const CFG = {
  count: 24,
  maxAlpha: 0.30,
  headAlpha: 0.55,
  angle: -Math.PI / 3.35,
  speedMin: 0.9,
  speedMax: 2.4,
  lenMin: 90,
  lenMax: 260,
  widthMin: 0.6,
  widthMax: 1.6,
  flareChance: 0.12,
};

function rnd(a: number, b: number) {
  return a + Math.random() * (b - a);
}

interface Meteor {
  x: number;
  y: number;
  len: number;
  sp: number;
  w: number;
  a: number;
  warm: boolean;
  life: number;
  ttl: number;
}

export default function MeteorShower() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cvs = cvsRef.current;
    if (!wrap || !cvs) return;

    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const compactViewport = window.innerWidth < 768;
    const tabletViewport = window.innerWidth < 1024;
    const meteorCount = compactViewport ? 8 : tabletViewport ? 14 : CFG.count;
    const DPR = Math.min(window.devicePixelRatio || 1, compactViewport ? 1.5 : 2);
    let W: number, H: number;
    let animId: number;

    function resize() {
      W = wrap!.clientWidth;
      H = wrap!.clientHeight;
      cvs!.width = W * DPR;
      cvs!.height = H * DPR;
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function spawn(initial: boolean): Meteor {
      const len = rnd(CFG.lenMin, CFG.lenMax);
      const warm = Math.random() < CFG.flareChance;
      return {
        x: rnd(-0.15, 1.45) * W,
        y: initial ? rnd(-0.2, 1.1) * H : rnd(-0.45, -0.05) * H,
        len,
        sp: rnd(CFG.speedMin, CFG.speedMax),
        w: rnd(CFG.widthMin, CFG.widthMax),
        a: rnd(0.35, 1) * CFG.maxAlpha,
        warm,
        life: 0,
        ttl: rnd(260, 620),
      };
    }

    const meteors: Meteor[] = Array.from({ length: meteorCount }, () => spawn(true));
    const dx = Math.cos(CFG.angle);
    const dy = -Math.sin(CFG.angle);

    const isStatic = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = "lighter";

      for (let i = 0; i < meteors.length; i++) {
        const m = meteors[i];
        m.life++;

        const p = m.life / m.ttl;
        const fade = Math.min(1, p * 6) * Math.min(1, (1 - p) * 6);
        const alpha = m.a * fade;

        const hx = m.x, hy = m.y;
        const tx = hx - dx * m.len, ty = hy - dy * m.len;

        const g = ctx!.createLinearGradient(hx, hy, tx, ty);
        const hue = m.warm ? "38, 92%, 78%" : "215, 45%, 88%";
        g.addColorStop(0, `hsla(${hue},${alpha})`);
        g.addColorStop(0.14, `hsla(${hue},${alpha * 0.7})`);
        g.addColorStop(0.55, `hsla(${hue},${alpha * 0.18})`);
        g.addColorStop(1, `hsla(${hue},0)`);

        ctx!.strokeStyle = g;
        ctx!.lineWidth = m.w;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(hx, hy);
        ctx!.lineTo(tx, ty);
        ctx!.stroke();

        const hr = m.warm ? 7 : 4;
        const hg = ctx!.createRadialGradient(hx, hy, 0, hx, hy, hr);
        hg.addColorStop(0, m.warm
          ? `rgba(255,214,150,${CFG.headAlpha * fade})`
          : `rgba(235,244,255,${CFG.headAlpha * fade * 0.8})`);
        hg.addColorStop(1, "rgba(255,255,255,0)");
        ctx!.fillStyle = hg;
        ctx!.beginPath();
        ctx!.arc(hx, hy, hr, 0, 7);
        ctx!.fill();

        m.x += dx * m.sp;
        m.y += dy * m.sp;

        if (m.life >= m.ttl || m.y - m.len > H + 200 || m.x + m.len < -200) {
          meteors[i] = spawn(false);
        }
      }

      ctx!.globalCompositeOperation = "source-over";
      if (!isStatic) animId = requestAnimationFrame(draw);
    }

    if (isStatic) {
      meteors.forEach(m => { m.life = m.ttl * 0.5; });
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: "hidden" }}
    >
      <canvas ref={cvsRef} className="block w-full h-full" />
    </div>
  );
}
