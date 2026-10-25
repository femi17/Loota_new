import { HunterFigure } from "@/components/HunterFigure";
import { ChestArt } from "@/components/ChestArt";
import { Masquerade } from "@/components/game/Masquerade";
import { DEFAULT_LOOK } from "@/lib/avatar";

/**
 * The home page's picture of a hunt (owner, 25 Oct 2026: beat the competitors on graphics): a corner of the map, a
 * hunter with the riddle, the dotted way to a glowing chest, and the Masquerade peeping out from behind a building.
 */
export function HuntScene() {
  return (
    <div className="relative h-80 min-w-0 flex-[1_1_380px] overflow-hidden rounded-[28px] bg-map sm:h-96" role="img" aria-label="A hunter on the map following the way to a glowing chest, watched by the Masquerade">
      <svg viewBox="0 0 400 320" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        {/* Blocks of buildings */}
        <g fill="#D6CCB8">
          {[
            [20, 20, 70, 50], [110, 14, 60, 40], [250, 12, 50, 36], [320, 30, 60, 46], [20, 130, 54, 60], [140, 120, 70, 44],
            [240, 110, 44, 60], [330, 150, 50, 50], [30, 250, 70, 50], [150, 240, 60, 40], [280, 250, 60, 50],
          ].map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx="4" />
          ))}
        </g>
        {/* Streets, and a main road */}
        <g stroke="#FFFFFF" strokeLinecap="round" fill="none">
          <path d="M0 95 L400 80" strokeWidth="14" />
          <path d="M0 225 L400 215" strokeWidth="14" />
          <path d="M110 0 L95 320" strokeWidth="12" />
          <path d="M305 0 L315 320" strokeWidth="12" />
        </g>
        <path d="M225 0 Q215 160 235 320" stroke="#FFE7A8" strokeWidth="22" fill="none" />
        {/* The way to the chest */}
        <path className="loota-route" d="M128 288 Q150 232 200 222 T305 150 Q312 100 345 88" stroke="#F4B41A" strokeWidth="5" strokeLinecap="round" fill="none" />
      </svg>
      {/* The Masquerade, peeping from behind a building */}
      <div className="absolute right-[3%] top-[44%] origin-bottom scale-75 sm:scale-90">
        <Masquerade size={58} />
      </div>
      {/* The chest at the end of the way */}
      <div className="absolute right-[6%] top-[5%]">
        <ChestArt size={88} />
      </div>
      {/* The hunter, the riddle in mind */}
      <div className="absolute bottom-[8%] left-[9%] flex flex-col items-center">
        <span className="loota-bubble relative mb-2 max-w-40 rounded-xl bg-paper px-3 py-1.5 text-center text-[11px] font-bold leading-tight text-ink shadow-lg">
          “Where engines roar over the rooftops…”
        </span>
        <span className="loota-npc-idle">
          <HunterFigure look={{ ...DEFAULT_LOOK, extra: "cap", top: "jersey" }} width={46} label="A Loota hunter" />
        </span>
      </div>
    </div>
  );
}
