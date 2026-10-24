/**
 * The Masquerade (owner, 24 Oct 2026: the hunt's villain, light and playful): a dancer in tiers of raffia and cloth
 * strips, a carved wooden mask with white chalk markings and a crest of feathers. Sways and flutters (globals.css
 * .loota-masq*); `mood` changes the mask's eyes.
 */
export function Masquerade({ size = 160, mood = "sly" }: { size?: number; mood?: "sly" | "cross" | "beaten" }) {
  // Tiers of strips that overlap and flare out, ragged at the ends, like a real costume.
  const tiers = [
    { y: 66, w: 50, h: 40, colours: ["#F4B41A", "#E5484D", "#F5ECD8"] },
    { y: 90, w: 64, h: 42, colours: ["#1E9E62", "#F4B41A", "#13A3A3"] },
    { y: 116, w: 80, h: 44, colours: ["#7C4DCC", "#E85D9E", "#13A3A3"] },
    { y: 144, w: 96, h: 46, colours: ["#E5484D", "#F28C28", "#F4B41A"] },
  ];
  return (
    <svg width={size} height={(size * 200) / 120} viewBox="0 0 120 200" className="loota-masq overflow-visible" aria-hidden="true">
      {/* Feet peeping out */}
      <ellipse cx="50" cy="194" rx="8" ry="4" fill="#3A2410" />
      <ellipse cx="70" cy="194" rx="8" ry="4" fill="#3A2410" />
      {/* Tiers of strips, the widest at the bottom, each fluttering */}
      {[...tiers].reverse().map((t, ti) => {
        const strips = Math.round(t.w / 5);
        return (
          <g key={ti} className="loota-masq-fringe" style={{ animationDelay: `${ti * 0.12}s` }}>
            {[...Array(strips)].map((_, i) => {
              const sw = t.w / strips;
              const x = 60 - t.w / 2 + i * sw;
              const flare = ((x + sw / 2 - 60) / t.w) * 14; // the outer strips swing out
              const end = t.y + t.h - ((i * 7) % 5); // ragged ends
              return (
                <path
                  key={i}
                  d={`M${x} ${t.y} L${x + sw + 0.6} ${t.y} L${x + sw + 0.6 + flare} ${end} L${x + sw / 2 + flare} ${end + 4} L${x + flare} ${end}Z`}
                  fill={t.colours[i % 3]}
                  stroke="#3A2410"
                  strokeOpacity="0.25"
                  strokeWidth="0.5"
                />
              );
            })}
            <rect x={60 - t.w / 2 - 1} y={t.y - 2} width={t.w + 2} height="4" rx="2" fill="#3A2410" opacity="0.5" />
          </g>
        );
      })}
      {/* The crest of feathers */}
      <g className="loota-masq-crest">
        {[-26, -13, 0, 13, 26].map((a, i) => (
          <path key={a} d="M60 22 q-3 -16 0 -20 q3 4 0 20z" fill={["#E5484D", "#F4B41A", "#1E9E62", "#F4B41A", "#E5484D"][i]} transform={`rotate(${a} 60 24)`} />
        ))}
      </g>
      {/* The carved mask */}
      <ellipse cx="60" cy="46" rx="20" ry="25" fill="#8B5A2B" stroke="#4A2E14" strokeWidth="2" />
      <ellipse cx="60" cy="46" rx="15" ry="20" fill="#A06A34" />
      {/* White chalk markings */}
      <path d="M44 36 q16 -8 32 0" stroke="#F5ECD8" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M47 62 l4 4 M53 64 l3 4 M64 64 l-3 4 M70 62 l-4 4" stroke="#F5ECD8" strokeWidth="1.6" strokeLinecap="round" />
      {/* Eyes: sly (half-shut, sideways), cross (slanted), beaten (spirals) */}
      {mood === "beaten" ? (
        <g stroke="#1B120C" strokeWidth="1.6" fill="none">
          <path d="M49 44 a3 3 0 1 1 3 3 a1.6 1.6 0 1 1 -1.4 -1.6" />
          <path d="M67 44 a3 3 0 1 1 3 3 a1.6 1.6 0 1 1 -1.4 -1.6" />
        </g>
      ) : (
        <g>
          <ellipse cx="51" cy="45" rx="5" ry={mood === "sly" ? 2.4 : 3.4} fill="#F5ECD8" />
          <ellipse cx="69" cy="45" rx="5" ry={mood === "sly" ? 2.4 : 3.4} fill="#F5ECD8" />
          <circle cx={mood === "sly" ? 53 : 51} cy="45" r="1.8" fill="#1B120C" />
          <circle cx={mood === "sly" ? 71 : 69} cy="45" r="1.8" fill="#1B120C" />
          {mood === "cross" && <path d="M45 38 l11 4 M75 38 l-11 4" stroke="#1B120C" strokeWidth="2" strokeLinecap="round" />}
        </g>
      )}
      {/* The grin */}
      <path d={mood === "beaten" ? "M52 56 q8 -5 16 0" : "M51 54 q9 8 18 0"} stroke="#1B120C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
