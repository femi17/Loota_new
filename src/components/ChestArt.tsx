/**
 * The key's chest, drawn (owner, 25 Oct 2026: the first launch should look as good as the hunt): dark wood with gold
 * bands and a lock, glowing as if something precious is inside; `open` lifts the lid and lets the light out.
 */
export function ChestArt({ size = 96, open = false, glow = true }: { size?: number; open?: boolean; glow?: boolean }) {
  return (
    <svg width={size} height={(size * 100) / 120} viewBox="0 0 120 100" className="overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id="loota-chest-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE08A" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#F4B41A" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#F4B41A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="loota-chest-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8A5A2B" />
          <stop offset="100%" stopColor="#5C3A1A" />
        </linearGradient>
      </defs>
      {glow && <ellipse className="loota-chest-glow" cx="60" cy="58" rx="60" ry="46" fill="url(#loota-chest-aura)" />}
      {/* The light pouring out of an open chest */}
      {open && <path d="M30 46 L10 -10 L110 -10 L90 46 Z" fill="#FFE08A" opacity="0.35" className="loota-chest-glow" />}
      <ellipse cx="60" cy="94" rx="40" ry="5" fill="#000" opacity="0.18" />
      {/* Body */}
      <rect x="22" y="48" width="76" height="44" rx="5" fill="url(#loota-chest-wood)" stroke="#3A2410" strokeWidth="2" />
      <rect x="22" y="58" width="76" height="5" fill="#F4B41A" opacity="0.9" />
      <rect x="34" y="48" width="7" height="44" fill="#F4B41A" />
      <rect x="79" y="48" width="7" height="44" fill="#F4B41A" />
      {/* Lid: closed, or tipped back */}
      {open ? (
        <g>
          {/* Tipped back on its hinges: its dark inside faces us, gold-rimmed */}
          <path d="M24 48 L30 16 L90 16 L96 48 Z" fill="#3A2410" stroke="#F4B41A" strokeWidth="3" strokeLinejoin="round" />
          <path d="M34 46 L38 22 L82 22 L86 46 Z" fill="#5C3A1A" />
          {/* The glow of what's inside, at the chest's mouth */}
          <ellipse cx="60" cy="49" rx="34" ry="5" fill="#FFE08A" />
        </g>
      ) : (
        <g>
          <path d="M22 50 Q22 24 60 24 Q98 24 98 50 Z" fill="url(#loota-chest-wood)" stroke="#3A2410" strokeWidth="2" />
          <path d="M34 50 Q34 30 37.5 27 L41 26 L41 50 Z" fill="#F4B41A" />
          <path d="M79 26 L82.5 27 Q86 30 86 50 L79 50 Z" fill="#F4B41A" />
        </g>
      )}
      {/* The lock */}
      <rect x="53" y="52" width="14" height="16" rx="3" fill="#FFD45C" stroke="#8A5A10" strokeWidth="1.5" />
      <circle cx="60" cy="59" r="2.2" fill="#3A2410" />
      <rect x="59" y="60" width="2" height="4" fill="#3A2410" />
      {/* Glints */}
      {glow && (
        <g fill="#FFF7E0">
          <path className="loota-sparkle" d="M16 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" />
          <path className="loota-sparkle" style={{ animationDelay: "0.5s" }} d="M104 22 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" />
          <path className="loota-sparkle" style={{ animationDelay: "0.9s" }} d="M100 70 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" />
        </g>
      )}
    </svg>
  );
}
