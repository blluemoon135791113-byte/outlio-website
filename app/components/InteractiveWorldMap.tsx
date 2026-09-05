"use client";

import { useMemo } from "react";

interface ServiceMarker {
  id: string;
  name: string;
  x: number;
  y: number;
}

const SERVICE_MARKERS: ServiceMarker[] = [
  { id: "1", name: "ICP Research", x: 310, y: 80 },
  { id: "2", name: "Lead Sourcing", x: 500, y: 55 },
  { id: "3", name: "Multi-Channel Outreach", x: 190, y: 155 },
  { id: "4", name: "Product Launch", x: 400, y: 190 },
  { id: "5", name: "Personalized Outbound", x: 470, y: 250 },
  { id: "6", name: "Follow-up", x: 380, y: 330 },
  { id: "7", name: "A/B Testing", x: 520, y: 400 },
  { id: "8", name: "CRM", x: 560, y: 470 },
];

// Polygon outlines — stretched wider (x * 1.25) for horizontal proportion
const NORTH_AMERICA: [number, number][] = [
  [100, 39], [125, 29], [163, 26], [200, 23], [225, 33], [213, 46],
  [188, 52], [163, 49], [138, 55],
  [175, 36], [225, 29], [275, 26], [325, 23], [375, 20], [425, 16],
  [475, 20], [525, 18], [563, 23], [588, 29],
  [600, 36], [625, 46], [638, 59], [625, 72], [613, 85],
  [600, 98], [588, 111], [575, 124], [563, 137], [550, 150],
  [538, 160], [525, 169], [506, 179],
  [500, 189], [494, 202], [481, 211], [469, 205], [475, 192],
  [463, 185], [438, 182], [413, 179], [388, 182], [363, 185],
  [350, 192], [338, 202], [331, 215], [325, 228], [319, 237],
  [338, 241], [356, 237], [363, 231], [350, 221], [338, 218],
  [319, 244], [313, 254], [306, 263], [300, 270], [294, 276],
  [288, 286], [294, 293], [300, 299],
  [275, 247], [263, 234], [250, 221], [238, 208], [225, 195],
  [219, 185], [213, 176], [206, 166],
  [194, 169], [188, 159], [185, 150], [188, 140], [194, 130],
  [200, 124], [203, 114], [206, 104], [213, 94], [219, 85],
  [223, 78], [219, 72], [213, 65], [206, 59],
  [194, 55], [175, 52], [150, 49], [125, 46], [100, 39],
];

const GREENLAND: [number, number][] = [
  [538, 10], [575, 7], [613, 8], [650, 12], [675, 20],
  [681, 33], [669, 42], [650, 49], [625, 46], [600, 39],
  [575, 33], [556, 26], [544, 18], [538, 10],
];

const CENTRAL_AMERICA: [number, number][] = [
  [300, 299], [306, 306], [313, 312], [319, 315],
  [325, 319], [331, 322], [338, 324], [344, 326],
  [350, 328], [356, 332], [363, 335], [369, 337],
  [375, 338], [388, 342], [400, 343],
  [394, 348], [381, 346], [369, 343], [356, 341],
  [344, 338], [331, 335], [319, 330], [310, 325],
  [303, 320], [298, 312], [294, 306], [291, 299],
  [294, 294], [300, 299],
];

const SOUTH_AMERICA: [number, number][] = [
  [363, 351], [381, 348], [400, 345], [425, 343],
  [450, 345], [475, 348], [500, 351], [525, 354],
  [550, 356], [575, 361], [600, 364],
  [613, 371], [625, 380], [638, 390], [650, 403],
  [656, 416], [663, 429], [669, 442], [673, 455],
  [675, 468], [673, 481], [669, 494],
  [663, 507], [650, 520], [638, 533], [625, 546],
  [613, 559], [600, 572], [588, 585],
  [575, 598], [563, 611], [550, 624], [538, 637],
  [525, 650], [513, 663], [500, 676],
  [488, 689], [475, 702], [463, 715], [450, 728],
  [438, 741], [425, 751], [413, 757], [400, 761],
  [388, 757], [381, 751], [375, 741],
  [369, 728], [363, 715], [356, 702], [353, 689],
  [350, 676], [348, 663], [345, 650], [344, 637],
  [343, 624], [344, 611], [348, 598], [350, 585],
  [348, 572], [344, 559], [340, 546], [335, 533],
  [331, 520], [325, 507], [319, 494], [313, 481],
  [310, 468], [313, 455], [319, 442],
  [323, 429], [325, 416], [328, 403], [331, 390],
  [335, 380], [340, 371], [348, 363], [356, 356],
  [363, 351],
];

const CARIBBEAN_ISLANDS: [number, number][][] = [
  [[413, 221], [431, 218], [456, 216], [481, 218], [494, 221], [481, 224], [456, 226], [431, 224], [413, 221]],
  [[506, 228], [525, 226], [544, 228], [538, 231], [519, 232], [506, 231], [506, 228]],
  [[444, 234], [460, 233], [469, 235], [460, 238], [448, 237], [444, 234]],
  [[556, 231], [569, 229], [578, 231], [573, 234], [560, 234], [556, 231]],
];

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInAmericas(x: number, y: number): boolean {
  if (pointInPolygon(x, y, NORTH_AMERICA)) return true;
  if (pointInPolygon(x, y, SOUTH_AMERICA)) return true;
  if (pointInPolygon(x, y, CENTRAL_AMERICA)) return true;
  if (pointInPolygon(x, y, GREENLAND)) return true;
  for (const island of CARIBBEAN_ISLANDS) {
    if (pointInPolygon(x, y, island)) return true;
  }
  return false;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function distToEdge(x: number, y: number, polygon: [number, number][]): number {
  let minDist = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const ax = polygon[i][0], ay = polygon[i][1];
    const bx = polygon[j][0], by = polygon[j][1];
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
    const px = ax + t * dx, py = ay + t * dy;
    const dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

export default function InteractiveWorldMap() {

  const dots = useMemo(() => {
    const result: { x: number; y: number; size: number; color: string }[] = [];
    const rand = seededRandom(42);
    const spacing = 7;

    // Cluster centers for concentrated dark dots (like the reference)
    const clusters: [number, number][] = [
      [350, 100], [500, 130], [450, 200], [300, 250],
      [550, 380], [480, 450], [420, 520], [380, 600],
      [600, 420], [350, 400], [250, 180],
    ];

    for (let x = 80; x < 700; x += spacing) {
      for (let y = 5; y < 780; y += spacing) {
        if (!isInAmericas(x, y)) continue;
        if (rand() > 0.55) continue;

        const jx = x + (rand() - 0.5) * 2.5;
        const jy = y + (rand() - 0.5) * 2.5;

        const r = rand();

        let edgeDist = Infinity;
        if (pointInPolygon(jx, jy, NORTH_AMERICA)) edgeDist = distToEdge(jx, jy, NORTH_AMERICA);
        else if (pointInPolygon(jx, jy, SOUTH_AMERICA)) edgeDist = distToEdge(jx, jy, SOUTH_AMERICA);
        else if (pointInPolygon(jx, jy, CENTRAL_AMERICA)) edgeDist = distToEdge(jx, jy, CENTRAL_AMERICA);

        const nearEdge = edgeDist < 18;

        // Check if near a concentration cluster
        let inCluster = false;
        for (const [cx, cy] of clusters) {
          const dist = Math.sqrt((jx - cx) * (jx - cx) + (jy - cy) * (jy - cy));
          if (dist < 40) { inCluster = true; break; }
        }

        let color: string;
        let size: number;

        if ((nearEdge || inCluster) && r < 0.5) {
          color = "#0a0a08";
          size = 1.6;
        } else if (r < 0.50) {
          color = "#16150f";
          size = 1.2;
        } else if (r < 0.70) {
          color = "#605e55";
          size = 1.0;
        } else if (r < 0.88) {
          color = "#4f4bff";
          size = 1.2;
        } else {
          color = "#322ed1";
          size = 1.3;
        }

        result.push({ x: jx, y: jy, size, color });
      }
    }

    return result;
  }, []);

  const connections: [number, number][] = [
    [0, 1], [0, 2], [2, 3], [3, 4], [4, 5],
    [5, 6], [6, 7],
  ];

  return (
    <div
      className="relative mx-auto w-full max-w-[440px] lg:max-w-[470px]"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)",
      }}
    >
      <svg
        className="w-full h-auto"
        viewBox="0 0 750 780"
        preserveAspectRatio="xMidYMid meet"
      >
        {dots.map((dot, i) => {
          // Skip dots that would overlap label text areas
          const tooClose = SERVICE_MARKERS.some(
            (m) => Math.abs(dot.x - m.x) < 50 && dot.y > m.y - 22 && dot.y < m.y - 2
          );
          if (tooClose) return null;
          return (
            <circle
              key={`d-${i}`}
              cx={dot.x}
              cy={dot.y}
              r={dot.size}
              fill={dot.color}
              opacity={dot.color === "#0a0a08" ? 0.75 : dot.color === "#16150f" ? 0.6 : dot.color === "#605e55" ? 0.45 : 0.7}
            />
          );
        })}

        {connections.map(([a, b], idx) => {
          const m1 = SERVICE_MARKERS[a];
          const m2 = SERVICE_MARKERS[b];
          const dx = m2.x - m1.x;
          const dy = m2.y - m1.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const offset = d * 0.22;
          const cx = (m1.x + m2.x) / 2 + (-dy / d) * offset;
          const cy = (m1.y + m2.y) / 2 + (dx / d) * offset;

          return (
            <path
              key={`c-${idx}`}
              d={`M ${m1.x} ${m1.y} Q ${cx} ${cy} ${m2.x} ${m2.y}`}
              stroke="#4f4bff"
              strokeWidth="1.3"
              fill="none"
              opacity="0.4"
            />
          );
        })}

        {SERVICE_MARKERS.map((m) => (
          <circle
            key={`m-${m.id}`}
            cx={m.x}
            cy={m.y}
            r="4.5"
            fill="#4f4bff"
            opacity="0.9"
          />
        ))}

        {SERVICE_MARKERS.map((m) => (
          <g key={`l-${m.id}`}>
            <text
              x={m.x}
              y={m.y - 11}
              textAnchor="middle"
              className="text-[0.72rem] font-semibold"
              fill="white"
              stroke="white"
              strokeWidth="4"
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {m.name}
            </text>
            <text
              x={m.x}
              y={m.y - 11}
              textAnchor="middle"
              className="text-[0.72rem] font-semibold"
              fill="#16150f"
            >
              {m.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
