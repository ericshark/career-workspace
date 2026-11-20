"use client";
import { useEffect, useState } from "react";

const COLORS = [
  "#ff2d55",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
];

interface Bit {
  id: number;
  left: number;
  dx: number;
  dy: number;
  rot: number;
  color: string;
  delay: number;
  w: number;
}

/**
 * Dependency-free confetti burst. Bump `fire` (any new number > 0) to launch one burst; it cleans
 * itself up after ~2 s. Skipped entirely when the user prefers reduced motion.
 */
export function Confetti({ fire }: { fire: number }) {
  const [bits, setBits] = useState<Bit[]>([]);
  useEffect(() => {
    if (!fire) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const next = Array.from({ length: 60 }, (_, i) => ({
      id: fire * 1000 + i,
      left: 35 + Math.random() * 30,
      dx: (Math.random() - 0.5) * 700,
      dy: 250 + Math.random() * 450,
      rot: (Math.random() - 0.5) * 1080,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 0.15,
      w: 6 + Math.random() * 6,
    }));
    // Deferred so the state update isn't synchronous inside the effect body.
    const start = setTimeout(() => setBits(next), 0);
    const t = setTimeout(() => setBits([]), 2200);
    return () => {
      clearTimeout(start);
      clearTimeout(t);
    };
  }, [fire]);
  if (!bits.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {bits.map((b) => (
        <span
          key={b.id}
          className="absolute top-[18%] block rounded-[2px]"
          style={
            {
              left: `${b.left}%`,
              width: b.w,
              height: b.w * 0.45,
              background: b.color,
              animation: `confetti-fall 1.9s cubic-bezier(.15,.6,.35,1) ${b.delay}s both`,
              "--dx": `${b.dx}px`,
              "--dy": `${b.dy}px`,
              "--rot": `${b.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
