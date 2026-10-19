import { keeperLook, type AvatarLook } from "@/lib/avatar";

/**
 * Where a hunt key is won, as a scene (owner, 19 Oct 2026: "make every key location a scene"): the place looks like
 * what it is, and the person there asks the Key Trial. Chosen per key in /admin, or guessed from what's around the
 * spot; hunt_keys.scene in the database (the same names).
 */
export const KEY_SCENES = ["circle", "market", "landmark", "beach", "park", "motor_park", "school", "stadium", "palace"] as const;
export type KeyScene = (typeof KEY_SCENES)[number];

type Keeper = { name: string; look: AvatarLook };
const dressed = (name: string, change: Partial<AvatarLook>): Keeper => ({ name, look: { ...keeperLook(name), ...change } });

export const KEY_SCENE_INFO: Record<KeyScene, { label: string; sign: string; keeper: Keeper }> = {
  circle: {
    label: "Stone circle (anywhere)",
    sign: "",
    keeper: { name: "The Keeper", look: { skin: "#5C3A1E", hair: "bald", hairColour: "#1B120C", top: "hoodie", topColour: "#1E3A6E", bottomsColour: "#1E3A6E", extra: "none" } },
  },
  market: { label: "Market", sign: "Market", keeper: dressed("Iya Oloja", { topColour: "#E85D9E", bottomsColour: "#7C4DCC" }) },
  landmark: { label: "Monument plaza", sign: "Monument", keeper: dressed("Guide Bayo", { topColour: "#F4B41A", extra: "cap" }) },
  beach: { label: "Beach", sign: "Beach", keeper: dressed("Ebi the fisherman", { topColour: "#13A3A3", bottomsColour: "#1E3A6E", extra: "cap" }) },
  park: { label: "Park or garden", sign: "Park", keeper: dressed("Uche the park keeper", { topColour: "#1E9E62", bottomsColour: "#5B4636", extra: "cap" }) },
  motor_park: { label: "Motor park or bus stop", sign: "Motor park", keeper: dressed("Sule the conductor", { topColour: "#E5484D", extra: "cap" }) },
  school: { label: "School or university", sign: "Government College", keeper: dressed("Musa the gateman", { topColour: "#C2A878", bottomsColour: "#5B4636", extra: "cap" }) },
  stadium: { label: "Football pitch or stadium", sign: "Stadium", keeper: dressed("Coach Gbenga", { top: "jersey", topColour: "#1E9E62", bottomsColour: "#F4F1EA" }) },
  palace: { label: "Palace", sign: "Palace", keeper: dressed("Dogari the palace guard", { topColour: "#F4F1EA", bottomsColour: "#F4F1EA", extra: "cap" }) },
};

export const isKeyScene = (s: unknown): s is KeyScene => typeof s === "string" && (KEY_SCENES as readonly string[]).includes(s);
