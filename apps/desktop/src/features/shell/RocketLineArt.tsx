import { motion, useReducedMotion } from "motion/react";

/** Engineering-style line rocket + construction grid (Swiss / drafting aesthetic). */
export function RocketLineArt({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const draw = reduce
    ? undefined
    : {
        hidden: { opacity: 0.2 },
        show: {
          opacity: 1,
          transition: { duration: 0.75, ease: [0.2, 0.7, 0.2, 1] as const },
        },
      };

  return (
    <div className={`gb-line-art ${className}`.trim()} aria-hidden>
      <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="gb-line-art-svg">
        {/* Fine construction grid */}
        <g className="gb-line-art-grid" stroke="currentColor" strokeWidth="0.5" opacity="0.22">
          {Array.from({ length: 13 }, (_, i) => (
            <line key={`v${i}`} x1={20 + i * 16} y1={16} x2={20 + i * 16} y2={184} />
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <line key={`h${i}`} x1={20} y1={16 + i * 16} x2={220} y2={16 + i * 16} />
          ))}
        </g>
        {/* Construction circle */}
        <circle className="gb-line-art-guide" cx="120" cy="100" r="62" stroke="currentColor" strokeWidth="0.6" opacity="0.28" />
        <circle className="gb-line-art-guide" cx="120" cy="100" r="38" stroke="currentColor" strokeWidth="0.5" opacity="0.18" strokeDasharray="2 3" />

        <motion.g
          initial={reduce ? undefined : "hidden"}
          animate={reduce ? undefined : "show"}
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Rocket body */}
          <motion.path
            variants={draw}
            d="M120 28 C128 48 132 72 132 108 L132 148 L108 148 L108 108 C108 72 112 48 120 28 Z"
          />
          {/* Nose tip */}
          <motion.path variants={draw} d="M120 28 L120 22" />
          {/* Window */}
          <motion.circle variants={draw} cx="120" cy="72" r="7" />
          <motion.circle variants={draw} cx="120" cy="72" r="3.5" opacity="0.5" />
          {/* Fins */}
          <motion.path variants={draw} d="M108 130 L88 158 L108 148" />
          <motion.path variants={draw} d="M132 130 L152 158 L132 148" />
          {/* Engine base */}
          <motion.path variants={draw} d="M112 148 L112 158 M128 148 L128 158 M116 158 L124 158" />
          {/* Center line */}
          <motion.path variants={draw} d="M120 40 L120 148" opacity="0.35" strokeDasharray="3 4" />
          {/* Dimension ticks (math/drafting) */}
          <motion.path variants={draw} d="M96 108 L104 108 M136 108 L144 108" opacity="0.5" />
          <motion.path variants={draw} d="M88 40 L88 158 M84 40 L92 40 M84 158 L92 158" opacity="0.4" />
        </motion.g>
      </svg>
    </div>
  );
}

/** Compact mark for sidebar brand. */
export function RocketMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`gb-rocket-mark ${className}`.trim()}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="2" className="gb-rocket-mark-frame" />
      <path
        d="M16 5 C18.2 10 19 15 19 20 L19 25 L13 25 L13 20 C13 15 13.8 10 16 5 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="14" r="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M13 22 L9 27 L13 25" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M19 22 L23 27 L19 25" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
