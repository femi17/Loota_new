/**
 * The Djinn's Wonders (design doc 7.7): relics so strong every player wishes
 * they held one. One of each in the world; held in secret; usable any time in
 * a live hunt (the Carpet any time). Must match the list in djinn_open_wager() and use_wonder() in the database.
 */
export type WonderId =
  | "cataclysm_orb"
  | "djinn_coin"
  | "orb_of_oblivion"
  | "orb_of_return"
  | "eye_of_the_djinn"
  | "hourglass_of_ages"
  | "master_key"
  | "phantom_cloak"
  | "carpet_of_kings"
  | "thiefs_hand"
  | "djinns_bargain"
  | "sandstorm_crown"
  | "mirror_of_many"
  | "seers_seal";

export const WONDERS: Record<WonderId, { name: string; icon: string; effect: string; boast: string }> = {
  cataclysm_orb: {
    name: "the Cataclysm Orb",
    icon: "💥",
    effect: "During a live hunt, wipes out every hunter: all keys gone, everyone (you too) sent home.",
    boast: "an orb that can end every hunt in one white flash",
  },
  djinn_coin: {
    name: "the Djinn's Coin",
    icon: "🪙",
    effect: "An extra life, once: a wipe passes you by, or a trial or the whirlwind can't throw you.",
    boast: "a coin that buys back your life when all others fall",
  },
  orb_of_oblivion: {
    name: "the Orb of Oblivion",
    icon: "🌑",
    effect: "Every other hunter loses all their keys in the current hunt.",
    boast: "an orb that makes every rival forget every key they found",
  },
  orb_of_return: {
    name: "the Orb of Return",
    icon: "🌀",
    effect: "Every hunter, you too, is sent home. Keys stay.",
    boast: "an orb that pulls every hunter back to where they began",
  },
  eye_of_the_djinn: {
    name: "the Eye of the Djinn",
    icon: "👁",
    effect: "For 10 minutes, see every hunter and the area of the key each is chasing.",
    boast: "an eye that sees every hunter and every secret they chase",
  },
  hourglass_of_ages: {
    name: "the Hourglass of Ages",
    icon: "⌛",
    effect: "Every other hunter is frozen in place for 3 minutes.",
    boast: "an hourglass that stops the world while you alone walk",
  },
  master_key: {
    name: "the Master Key",
    icon: "🗝",
    effect: "Opens one key without its trial: stand on the key's spot (you must still find it).",
    boast: "a key that opens any lock without a single question",
  },
  phantom_cloak: {
    name: "the Phantom Cloak",
    icon: "🧥",
    effect: "For the rest of a hunt, invisible on the map and the broadcast; untouched by every Wonder but the Cataclysm.",
    boast: "a cloak that makes you a ghost for a whole hunt",
  },
  carpet_of_kings: {
    name: "the Carpet of Kings",
    icon: "🧞",
    effect: "One instant flight to anywhere in the world.",
    boast: "a carpet that flies you anywhere in the world in a blink",
  },
  thiefs_hand: {
    name: "the Thief's Hand",
    icon: "✋",
    effect: "Takes the latest key from every hunter within 1 km and keeps one.",
    boast: "a hand that plucks keys from the pockets of every hunter near you",
  },
  djinns_bargain: {
    name: "the Djinn's Bargain",
    icon: "🤝",
    effect: "Swap places on the map with the hunter in the lead.",
    boast: "a bargain that puts you where the leader stands, and the leader where you stood",
  },
  sandstorm_crown: {
    name: "the Sandstorm Crown",
    icon: "👑",
    effect: "A sandstorm within 400 km for 30 minutes: everyone in it moves at half speed but you.",
    boast: "a crown that buries a whole country in sand while you ride the wind",
  },
  mirror_of_many: {
    name: "the Mirror of Many",
    icon: "🪞",
    effect: "Three copies of you walk the map for the rest of a hunt; nobody knows which is real.",
    boast: "a mirror that makes three of you, and none can tell which is true",
  },
  seers_seal: {
    name: "the Seer's Seal",
    icon: "🔮",
    effect: "On the Djinn's map, before you choose a seal, every decoy burns: you see the real place.",
    boast: "a seal that shows you the one true place at my next Wager",
  },
};

export const wonderOf = (id: string) => WONDERS[id as WonderId] ?? { name: "a Wonder", icon: "✨", effect: "", boast: "a Wonder beyond price" };
