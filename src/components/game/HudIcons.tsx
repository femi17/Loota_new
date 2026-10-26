import type { ReactNode } from "react";
import type { VehicleKind } from "@/game/economy";

/** Line icons for the game screen, drawn the same on every phone (emoji differ between devices). */
function Svg({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const DirectionsIcon = () => (
  <Svg>
    <path d="M12 2l9 9-9 9-9-9z" />
    <path d="M9 13v-2a1 1 0 0 1 1-1h4M12 8l2 2-2 2" />
  </Svg>
);

export const WalkIcon = () => (
  <Svg>
    <circle cx="13" cy="4" r="2" />
    <path d="M9.5 21l2.5-6 3 3v3M8 12l3.5-4 3 3 3 1M11.5 8L11 14" />
  </Svg>
);

export const BicycleIcon = () => (
  <Svg>
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="18.5" cy="17.5" r="3.5" />
    <circle cx="15" cy="5" r="1" />
    <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
  </Svg>
);

export const MotorbikeIcon = () => (
  <Svg>
    <circle cx="5" cy="17" r="3" />
    <circle cx="19" cy="17" r="3" />
    <path d="M5 17l4-6h5l3 4h2M9 11L8 8H5.5M14 11l2-5h2.5" />
  </Svg>
);

export const CarIcon = () => (
  <Svg>
    <path d="M19 17h2a1 1 0 0 0 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4a1 1 0 0 0 1 1h2" />
    <circle cx="7" cy="17" r="2" />
    <path d="M9 17h6" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);

export const VehicleIcon = ({ kind }: { kind: VehicleKind | null }) =>
  kind === "bicycle" ? <BicycleIcon /> : kind === "motorbike" ? <MotorbikeIcon /> : kind === "car" ? <CarIcon /> : <WalkIcon />;

export const BusIcon = () => (
  <Svg>
    <path d="M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2s-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" />
    <circle cx="7" cy="18" r="2" />
    <path d="M9 18h5" />
    <circle cx="16" cy="18" r="2" />
  </Svg>
);

export const LandmarkIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z" />
  </Svg>
);

/** An old oil lamp with a flame: the lamp (design doc 7.4). */
export const LampIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2.5 12.5c0 2.5 2.5 4 5.5 4h6c3 0 5.5-2.5 6.5-6l1-2.5-3 1.5c-1 .6-2 .8-3 .8H8c-3 0-5.5 1-5.5 2.2z" />
    <path d="M9 16.5L8 20h8l-1-3.5" />
    <path d="M12 3c1.3 1.6 1.3 3.2 0 4.6-1.3-1.4-1.3-3 0-4.6z" />
  </Svg>
);

/** A trophy cup: the hunt's leaderboard (drawn like the other tools, owner 26 Oct 2026). */
export const TrophyIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 4.4M17 6h2.5a2.5 2.5 0 0 1-2.6 4.4" />
    <path d="M12 14v3M8.5 20.5h7M9.5 17h5l.5 3.5h-6z" />
  </Svg>
);

/** The inventory: a backpack (not a shopping bag: nothing is sold in it). */
export const BagIcon = () => (
  <Svg>
    <path d="M6 10a6 6 0 0 1 12 0v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM10 4.6a2 2 0 0 1 4 0M9 14h6v4H9zM9 11h6" />
  </Svg>
);

export const BackIcon = () => (
  <Svg size={20}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
