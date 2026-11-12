"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createClient } from "@/lib/supabase/client";
import type { AvatarLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import type { HouseObjectView, HouseRoomView, HouseStyle, InnerRoomView } from "@/game/house3d";
import { buildKeyWorld, type KeyScene, type KeyWorld, type Point } from "@/game/keyworld";
import { daylight, sunAt } from "@/game/sun";
import { cue } from "@/game/sound";
import { RELIC_ICON, RELICS, type RelicId } from "@/game/items";
import { AnswerMirror } from "@/components/game/puzzles/mirror";
import { PuzzleBoard } from "./puzzles/PuzzleTrial";
import { PUZZLE_NAMES } from "@/game/puzzles/names";
import type { Penalty } from "./PenaltyCard";
import { Joystick, useHandheld } from "./Joystick";

type Item = { id: string; name: string; icon: string };
/** What happens at the key's place, for the map to save for the broadcast (GameMap: worldTalk). */
// (Quiet in the Djinn's world: the broadcast is a hunt's.)
let quietShow = false;
const tellShow = (type: string, data?: unknown) => !quietShow && window.dispatchEvent(new CustomEvent("loota:world", { detail: { type, data } }));
type QuarterView = {
  ok: boolean;
  reason?: string;
  key: number;
  title: string;
  style: HouseStyle;
  layout?: string | null;
  /** What the key's place looks like (its ground and landmark). */
  scene?: KeyScene | null;
  /** The place the hunter is in, and the one they last searched. */
  room: string | null;
  dug?: string | null;
  outUntil: string | null;
  rooms: HouseRoomView[];
  objects: HouseObjectView[];
  items: Item[];
  /** The treasure building, found: its five rooms, shut or opened with what they held. */
  inner?: InnerRoomView[] | null;
  at: { lng: number; lat: number };
};
/** A room of the treasure building being opened: its puzzle (from /api/house/room), and when its time ends. */
type RoomPuzzle = { n: number; kind: string; puzzle: unknown; ends: number };
const NEAR_M = 6; // the detector reads a place from the street this close to its way in (swept round, it reaches)
const BEEP_M = 20; // it beeps within this of the key's place, faster the closer
/** The detector reads a place only from this close to it (owner, 8 Nov 2026: "The room should not be an obvious find,
 * they should walk around before seeing it"): it used to read every place as the hunter arrived. */
const DETECT_M = 12;
type Opened = {
  ok?: boolean;
  right?: boolean;
  /** A lock of the chain opened: which (1 or 2 of 3), and the room of the next. */
  lock?: number;
  next?: number;
  /** A wrong answer to a puzzle of questions: how many are right. */
  rightOf?: { right: number; of: number } | null;
  reason?: string;
  outcome?: InnerRoomView["outcome"];
  coins?: number;
  balance?: number;
  chapter?: number;
  award?: unknown;
  /** The Djinn's vault: where, and the Wonder won there. */
  place?: string;
  wonder?: string;
  extraWonder?: string | null;
  penalty?: Penalty & { balance: number | null; energy: number | null; moveTo?: { lng: number; lat: number } | null };
};
const HEAT: Record<string, { text: string; style: string }> = {
  hot: { text: "📡 Hot!", style: "bg-danger text-white" },
  warm: { text: "📡 Warm", style: "bg-[#F28C28] text-ink" },
  cold: { text: "📡 Cold", style: "bg-[#2F6FEB] text-white" },
};
type Dug = Partial<QuarterView> & { seconds?: number; locked?: boolean; text?: string; trap?: boolean; used?: { name: string } | null; penalty?: Penalty & { balance: number | null; energy: number | null }; until?: string; dodge?: { prompt: string; options: string[]; seconds: number } };

const SPEED = 4; // metres a second, walking about
const AVATAR = 0.8; // the hunter's size in the world
// The camera, as the map's (owner, 4 Nov 2026: "it is showing from afar, it shows rotate like the map camera"): behind
// the hunter and a little above, turning as they turn ("back": metres behind, "up": metres above); higher inside a
// place, its roof off; or the whole town from above
const EYE = { street: { back: 7.5, up: 4.6 }, inside: { back: 6, up: 6.5 }, wide: new THREE.Vector3(0, 88, 64) };
// How far out: the wheel or a pinch, within these
const ZOOM = { phone: 1.6, laptop: 1.8, min: 0.55, max: 3 }; // owner, 4 Nov 2026: "too zoomed in"
const TURN = 2.6; // radians a second, turning with the keys
const STICK_TURN = 1.7; // …and with the joystick pushed all the way to one side
const REFUSED: Record<string, string> = {
  away: "On the map you're no longer at the key's place, so it won't open. Leave, and go back to it.",
  no_house: "There's nothing to search here.",
  not_live: "The hunt isn't on right now.",
  not_hunting: "You're not in this hunt.",
  dodge: "Answer the challenge first!",
  far: "You're too far from the place now: go back within 300 m of it.",
  none: "The Djinn's Wager is over for you here.",
  hunting: "The Djinn waits while you race in a hunt: come back in free roam.",
  out: "Catch your breath first.",
  late: "⏳ Too slow: the lock has jammed. Try again in a moment.",
  chain: "This lock won't turn yet: open the one before it first.",
};

/** What a room held, said once it's open. */
const OUTCOME_SAID: Record<string, string> = {
  coins: "the coins are yours.",
  chapter: "the page of the story is on your scroll.",
  key: "the key.",
  lock: "open. Its note points to the next lock: follow the gold light.",
  decoy: "a fake chest. Nothing more here.",
  trap: "a trap, sprung. Nothing more here.",
  dust: "only sand. Nothing more here.",
  wonder: "the Djinn's Wonder, yours.",
  empty: "the vault is empty.",
  too_late: "emptied by another before you.",
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** What a locked find is called: the key's chest (room 1, at the right place), or a box in a house (rooms 2 to 5). */
/** The key's chest is the first of three locks (owner, 12 Nov 2026); 6 and 7 are the second and third. */
const boxNameOf = (n: number, djinn = false) =>
  djinn
    ? n === 1 ? "The vault's first lock" : n === 6 ? "The second lock" : n === 7 ? "The last lock" : "The box" // the Djinn's three locks
    : n === 1 ? "The key's chest" : n === 6 ? "The second lock" : n === 7 ? "The third lock" : "The box";

/** The tools of the key's world (owner, 3 Nov 2026: "torch light, metal detector, digger"), bought once and kept. */
type Tool = "detector" | "spade" | "torch";
const TOOLS: { id: Tool; icon: string; name: string; price: number; does: string }[] = [
  { id: "detector", icon: "📡", name: "Metal detector", price: 300, does: "Hot at the place the key is: from the street, and at its room's door." },
  { id: "spade", icon: "⛏", name: "Spade", price: 80, does: "Digs at once. By hand, digging takes a minute." },
  { id: "torch", icon: "🔦", name: "Torch", price: 60, does: "Lights the treasure house's dark rooms (and the night)." },
];
type Me = { coins: number; detector: boolean; spade: boolean; torch: boolean };
const OTHERS_SHOWN = 10; // other hunters drawn at once (owner: "let limit it to 10, so we dont overcrowd the screen")
/** Another hunter at the place, as last heard: where, which way, whether out of sight in a place. */
type Other = { x: number; z: number; r: number; in: boolean; seen: number };

/**
 * The key's world (owner, 3 Nov 2026, after the old mini-Loota: "when you get to the location you are thrown into
 * another world… we do not need the buttons for rooms, user can move freely using the movement we have designed").
 * The hunter walks the town round the key's landmark (the joystick, arrow keys or WASD, or tap where to go), the
 * camera following. Walking into one of the story's places is the choice: a wrong one springs its trap, an innocent
 * one is empty, and the right one shows its five rooms, each opened by walking up to its door and solving its puzzle.
 * Out in the open, ⛏ Dig. Only the server knows which place is which.
 */
export function QuarterScene({
  huntId,
  look,
  onClose,
  onPenalty,
  onMoved,
  onRefused,
  onCoins,
  onKey,
  onScroll,
  onBought,
  djinn,
}: {
  huntId: string;
  look: AvatarLook;
  onClose: () => void;
  /** (No longer used: the key's chest is opened here, by its puzzle.) */
  onOpenChest?: () => void;
  /** A trap: the penalty card shows; the place closes (`moveTo`: it sent the hunter back there). */
  onPenalty: (p: Penalty & { balance: number | null; energy: number | null; moveTo?: { lng: number; lat: number } | null }) => void;
  /** The server won't open it (the hunter isn't at the place): closed, with why, never a blank scene. */
  onRefused?: (text: string) => void;
  /** Coins found in a room: the new balance. */
  onCoins?: (balance: number) => void;
  /** The key found in a room (as a Key Trial won: the server's award). */
  onKey?: (award: unknown) => void;
  /** The server stood the hunter at the place. */
  onMoved: (at: { lng: number; lat: number }) => void;
  /** Open the story's scroll over the world (a story hunt). */
  onScroll?: () => void;
  /** A tool bought here (the map's own record of it: the detector beeps there too). */
  onBought?: (tool: Tool) => void;
  /** The Djinn's world (owner, 12 Nov 2026: "we make it like the key location… 3 puzzles to solve"): the same town at the
   * place chosen from the seals, on the server's djinn_world_* calls (no hunt). Behind its third lock, the vault: the
   * Wonder at the real place, empty at a false one (said, then the world closes). */
  djinn?: { onVault: (r: { outcome: string; place?: string; wonder?: string; extraWonder?: string | null }) => void };
}) {
  const [supabase] = useState(createClient);
  // The server's calls: a key's place (house_*), or the Djinn's world (djinn_world_*)
  const call = (fn: "view" | "step" | "enter" | "dodge", args: { room?: string | null; choice?: number } = {}) =>
    djinn
      ? fn === "view"
        ? supabase.rpc("djinn_world_view")
        : fn === "dodge"
          ? supabase.rpc("djinn_world_dodge", { p_choice: args.choice })
          : supabase.rpc(`djinn_world_${fn}`, { p_room: args.room ?? null })
      : fn === "view"
        ? supabase.rpc("house_view", { p_hunt: huntId })
        : fn === "dodge"
          ? supabase.rpc("house_dodge", { p_hunt: huntId, p_choice: args.choice })
          : supabase.rpc(`house_${fn}`, { p_hunt: huntId, p_room: args.room ?? null });
  const isDjinn = !!djinn;
  useLayoutEffect(() => {
    quietShow = isDjinn;
  }, [isDjinn]);
  const boxName = (n: number) => boxNameOf(n, isDjinn);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<QuarterView | null>(null);
  const [say, setSay] = useState<string>(
    djinn
      ? "🧞 The Djinn's ground. Walk about (the joystick, the arrow keys, or tap where to go) and go into the place you think hides his vault: the wrong ones are trapped. Three locks stand between you and what's inside."
      : "Walk about the place (the joystick, the arrow keys, or tap where to go). Go into the place you think it is: a wrong one bites. Out in the open, dig.",
  );
  const [standing, setStanding] = useState(-1); // the place the hunter is in (-1: out in the town)
  const [near, setNear] = useState(-1); // the place the detector reads: the one stood in, or the nearest way in
  const [wide, setWide] = useState(false); // the whole town asked for
  /** The way to the chain's next lock (owner, 12 Nov 2026): which way on the screen (degrees, 0 up), and how far. */
  const [toLock, setToLock] = useState<{ n: number; turn: number; metres: number } | null>(null);
  // The joystick on phones and tablets (Joystick.tsx): where the thumb is, read by the walking every frame.
  const joy = useRef({ x: 0, y: 0 });
  const handheld = useHandheld();
  const wideRef = useRef(wide);
  useEffect(() => {
    wideRef.current = wide;
  }, [wide]);
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<Item | null>(null);
  // For the broadcast (owner, 9 Nov 2026: step 3, "the key location… we can broadcast that too for viewers"): the map
  // saves the hunter's own arrangement of the place, where they walk, what they're told and the puzzles they open
  const worldTold = useRef(false);
  const lastProgress = useRef(-1);
  // The board's answers as the hunter puts them in (owner, 9 Nov 2026: "the users answers in the 3d world is not
  // displayed"): each change, at most every 0.6 s, for the broadcast to show on its card
  const answers = useRef<{ n: number; a: Record<string, unknown>; sent: string; at: number; timer: number }>({ n: 0, a: {}, sent: "", at: 0, timer: 0 });
  const answerMirror = useMemo(
    () => ({
      record: (key: string, value: unknown) => {
        const s = answers.current;
        s.a = { ...s.a, [key]: value };
        window.clearTimeout(s.timer);
        s.timer = window.setTimeout(() => {
          const now = JSON.stringify(s.a);
          if (now === s.sent) return;
          s.sent = now;
          s.at = Date.now();
          tellShow("answers", { n: s.n, a: s.a });
        }, Math.max(0, 600 - (Date.now() - s.at)));
      },
    }),
    [],
  );
  const [dodge, setDodge] = useState<{ room: number; prompt: string; options: string[]; seconds: number } | null>(null);
  const [roomPuzzle, setRoomPuzzle] = useState<RoomPuzzle | null>(null);
  const roomPuzzleRef = useRef<RoomPuzzle | null>(null);
  useEffect(() => {
    roomPuzzleRef.current = roomPuzzle;
  }, [roomPuzzle]);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [roomShake, setRoomShake] = useState(0);
  const [roomLeft, setRoomLeft] = useState(0); // seconds left on the open room's puzzle
  // The metal detector: how hot each place is (house_detect), and inside the treasure building each room
  // (house_room_detect: only the key's room is hot); once each visit; "none": no detector.
  const [heat, setHeat] = useState<Record<string, string>>({});
  const heatAsked = useRef(new Set<string>());
  // Who the hunter is (their own arrangement of the places, and the others at the place), what they have
  const [uid, setUid] = useState<string | null>(null);
  const uidRef = useRef("");
  useEffect(() => {
    if (!view || !uid || worldTold.current) return;
    worldTold.current = true;
    tellShow("start", {
      kind: "keyworld",
      key: view.key,
      title: view.title,
      scene: view.scene ?? null,
      rooms: view.rooms,
      objects: view.objects,
      seat: `${uid}:${view.key}`,
      inner: view.inner ?? null,
      dug: view.dug ?? null,
      at: view.at,
    });
  }, [view, uid]);
  useEffect(() => () => void (worldTold.current && tellShow("end")), []);
  useEffect(() => {
    if (worldTold.current) tellShow("state", { inner: view?.inner ?? null, dug: view?.dug ?? null });
  }, [view?.inner, view?.dug]);
  useEffect(() => {
    if (worldTold.current && say) tellShow("note", say);
  }, [say]);
  useEffect(() => {
    if (!roomPuzzle) return;
    lastProgress.current = -1;
    window.clearTimeout(answers.current.timer);
    answers.current = { n: roomPuzzle.n, a: {}, sent: "", at: 0, timer: 0 };
    tellShow("puzzle", { n: roomPuzzle.n, kind: roomPuzzle.kind, puzzle: roomPuzzle.puzzle, seconds: Math.max(0, Math.round((roomPuzzle.ends - Date.now()) / 1000)) });
  }, [roomPuzzle]);
  const [me, setMe] = useState<Me | null>(null);
  const torchRef = useRef(false);
  const detectorRef = useRef(false); // the detector, in the hunter's hand when they have one
  const wandHeatRef = useRef(""); // what it reads now (its head glows with it)
  const hotRef = useRef(-1); // the place it found hot (the key's), once read
  const [inRange, setInRange] = useState(""); // the places the detector can read from here ("2,5")
  // A Key Trial on (the chest's puzzle): the detector is quiet (owner, 8 Nov 2026: "when user is doing the puzzle, the
  // beeping from the metal detector should stop")
  const trialOnRef = useRef(false);
  useEffect(() => {
    const on = (e: Event) => (trialOnRef.current = !!(e as CustomEvent<{ on: boolean }>).detail?.on);
    window.addEventListener("loota:trial", on);
    return () => window.removeEventListener("loota:trial", on);
  }, []);
  useEffect(() => {
    detectorRef.current = !!me?.detector;
  }, [me?.detector]);
  useEffect(() => {
    torchRef.current = !!me?.torch;
    scene.current?.world.setDark(!me?.torch);
  }, [me?.torch]);
  const [bagOpen, setBagOpen] = useState(false);
  const [bagNote, setBagNote] = useState<string | null>(null);
  const [buying, setBuying] = useState<Tool | null>(null);
  const [carried, setCarried] = useState<{ relics: { id: string; relic: RelicId; charges: number }[]; wonders: { id: string; wonder: string }[] } | null>(null);
  // Other hunters at the place: everyone here counted, the nearest few drawn
  const [othersHere, setOthersHere] = useState(0);
  const othersRef = useRef(new Map<string, Other>());
  const looksRef = useRef(new Map<string, AvatarLook>());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Digging by hand: a minute on the spot (a spade digs at once)
  const [digging, setDigging] = useState<{ i: number; ends: number } | null>(null);
  const diggingRef = useRef(digging);
  useEffect(() => {
    diggingRef.current = digging;
  }, [digging]);
  const [digLeft, setDigLeft] = useState(0);
  const [heard, setHeard] = useState(0); // bumped to ask the detector again (one just bought)
  const openRoomRef = useRef<(n: number) => Promise<void>>(async () => {});
  // The action button: what's at hand now (a box, a thing, a locked door), done by a tap or Enter / E / Space
  type Action = { kind: "box"; n: number; label: string } | { kind: "thing"; id: string; label: string } | { kind: "door"; i: number; label: string };
  const [action, setAction] = useState<Action | null>(null);
  const actionRef = useRef<Action | null>(null);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  const doActionRef = useRef<() => void>(() => {});
  // Looking at a thing in a place (a drawer, a portrait…): by tapping it, or walking up to it
  const touchRef = useRef<(id: string) => Promise<void>>(async () => {});
  useEffect(() => {
    touchRef.current = async (id: string) => {
      if (busyRef.current) return;
      setBusy(true);
      try {
        // The place it's in, told to the server first (it hands nothing over unless it knows the hunter is there)
        const room = viewRef.current?.objects.find((o) => o.id === id)?.room;
        if (room) await call("step", { room });
        const { data } = await supabase.rpc("house_touch", { p_hunt: huntId, p_object: id });
        const t = data as (Partial<QuarterView> & { text?: string; gained?: Item | null }) | null;
        if (!t?.ok) return setSay("You can't reach that from here.");
        setView((old) => (old ? { ...old, ...(t as QuarterView) } : old));
        setSay(t.text ?? "");
        if (t.gained) {
          setGained(t.gained);
          setTimeout(() => setGained(null), 2600);
        }
      } finally {
        setBusy(false);
      }
    };
  });
  const enterRef = useRef<(i: number) => Promise<void>>(async () => {});
  const scene = useRef<{ world: KeyWorld; walkTo: (path: Point[]) => Promise<void>; at: () => Point; shake: () => void; trap: (kind: string, i: number) => void } | null>(null);
  const viewRef = useRef<QuarterView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // The place from the server; then the world round it.
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(async ({ data: s }) => {
      // Who this is (their own arrangement of the places depends on it): from the session, or asked of the server
      const id = s.session?.user.id ?? (await supabase.auth.getUser()).data.user?.id ?? "";
      if (!live) return;
      uidRef.current = id;
      setUid(id);
      const { data: p } = await supabase.from("profiles").select("coins, detector, spade, torch").eq("id", id).maybeSingle();
      if (live && p) setMe({ coins: Number(p.coins ?? 0), detector: !!p.detector, spade: !!p.spade, torch: !!p.torch });
    });
    void call("view").then(({ data }) => {
      if (!live) return;
      const v = data as QuarterView | null;
      if (!v?.ok) {
        // A challenge left unanswered last time: its trap springs now.
        const left = (v as { penalty?: Penalty & { balance: number | null; energy: number | null } } | null)?.penalty;
        if (left) return onPenalty(left);
        const why = REFUSED[v?.reason ?? ""] ?? "This place won't open right now.";
        if (onRefused) onRefused(why);
        else setSay(why);
        return;
      }
      onMoved(v.at);
      setView(v);
    });
    return () => {
      live = false;
    };
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huntId]);

  // The other hunters at this key's place (owner, 3 Nov 2026: "see the number users who are around, let limit it to
  // 10"): everyone here is counted (presence, with their look); where each one walks comes a few times a second.
  const worldKey = view?.key;
  useEffect(() => {
    if (!uid || worldKey == null || isDjinn) return;
    const others = othersRef.current, looks = looksRef.current;
    const ch = supabase.channel(`keyworld:${huntId}:${worldKey}`, { config: { private: true, presence: { key: uid }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, { look?: AvatarLook }[]>;
      const ids = Object.keys(state).filter((k) => k !== uid);
      for (const k of ids) {
        const lk = state[k]?.[0]?.look;
        if (lk) looks.set(k, lk);
      }
      for (const k of [...others.keys()]) if (!ids.includes(k)) others.delete(k);
      setOthersHere(ids.length);
    });
    ch.on("broadcast", { event: "pos" }, ({ payload }) => {
      const p = payload as { u?: string; x: number; z: number; r: number; in: boolean };
      if (p?.u && p.u !== uid) others.set(p.u, { x: p.x, z: p.z, r: p.r, in: !!p.in, seen: Date.now() });
    });
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") {
        if (channelRef.current === ch) channelRef.current = null; // dropped: stop sending until it's back
        return;
      }
      void ch.track({ look });
      channelRef.current = ch;
    });
    return () => {
      channelRef.current = null;
      others.clear();
      void supabase.removeChannel(ch);
    };
  }, [uid, worldKey, huntId, supabase, look, isDjinn]);

  /** Buy a tool here (owner, 3 Nov 2026: "user should be able to buy thing"). */
  async function buy(tool: Tool) {
    const t = TOOLS.find((x) => x.id === tool)!;
    setBuying(tool);
    setBagNote(null);
    try {
      const { data } = await supabase.rpc("buy_tool", { p_tool: tool });
      const r = data as { ok: boolean; reason?: string; balance?: number; price?: number } | null;
      if (r?.ok) {
        setMe((m) => (m ? { ...m, [tool]: true, coins: r.balance != null ? Number(r.balance) : m.coins } : m));
        if (r.balance != null) onCoins?.(Number(r.balance));
        onBought?.(tool);
        if (tool === "detector") {
          // Ask again, now with one
          heatAsked.current.clear();
          setHeard((h) => h + 1);
        }
        setBagNote(`${t.icon} ${t.name}: yours to keep.`);
      } else if (r?.reason === "coins") setBagNote(`Not enough coins: the ${t.name.toLowerCase()} costs ${r.price ?? t.price}.`);
      else if (r?.reason === "owned") setBagNote(`You already have a ${t.name.toLowerCase()}.`);
      else setBagNote("Couldn't buy it right now. Try again.");
    } finally {
      setBuying(null);
    }
  }
  async function openBag() {
    setBagOpen(true);
    setBagNote(null);
    const [{ data: relics }, { data: wonders }] = await Promise.all([
      supabase.from("player_relics").select("id, relic, charges, expires_at").gt("charges", 0),
      supabase.from("player_wonders").select("id, wonder, expires_at").is("used_at", null),
    ]);
    const live = (x: { expires_at: string }) => Date.parse(x.expires_at) > Date.now();
    setCarried({
      relics: ((relics ?? []) as { id: string; relic: RelicId; charges: number; expires_at: string }[]).filter(live),
      wonders: ((wonders ?? []) as { id: string; wonder: string; expires_at: string }[]).filter(live),
    });
  }

  /** ⛏ Dig here: with a spade at once; by hand a minute on the spot (owner: "1 min digging"; the server counts it). */
  async function startDig(i: number) {
    const v = viewRef.current;
    if (!v || i < 0 || busyRef.current || diggingRef.current) return;
    setBusy(true);
    const { data } = await supabase.rpc("house_dig_start", { p_hunt: huntId, p_room: v.rooms[i].id });
    setBusy(false);
    const r = data as { ok: boolean; reason?: string; seconds?: number } | null;
    if (!r?.ok) return setSay(REFUSED[r?.reason ?? ""] ?? "The ground won't give here.");
    if (!r.seconds) return void search(i);
    setDigLeft(r.seconds);
    setDigging({ i, ends: Date.now() + r.seconds * 1000 });
    setSay(`⛏ Digging by hand at ${v.rooms[i].name}: a minute on the spot. (A spade digs at once.)`);
  }
  useEffect(() => {
    if (!digging) return;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((digging.ends - Date.now()) / 1000));
      setDigLeft(left);
      if (left > 0) return;
      window.clearInterval(t);
      setDigging(null);
      void search(digging.i);
    }, 250);
    return () => window.clearInterval(t);
    // The timer belongs to this dig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digging]);

  // Into a place (or out of it): the server notes it (and opens a door with the thing it needs).
  const stepRef = useRef<(i: number) => Promise<boolean>>(async () => true);
  useEffect(() => {
    stepRef.current = async (i: number) => {
      const v = viewRef.current;
      if (!v) return false;
      const { data } = await call("step", { room: i >= 0 ? v.rooms[i].id : null });
      const r = data as (Partial<QuarterView> & { locked?: boolean; text?: string; used?: { name: string } | null; reason?: string }) | null;
      if (!r?.ok) {
        setSay(REFUSED[r?.reason ?? ""] ?? "You can't go there right now.");
        return false;
      }
      if (r.locked) {
        setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
        return false;
      }
      setView((old) => (old ? { ...old, ...(r as QuarterView) } : old));
      if (i >= 0) {
        const open = v.rooms[i].outdoor === true;
        if (r.used) {
          scene.current?.world.setLocked(i, false);
          setSay(`You use ${r.used.name}: the ${open ? "gate" : "door"} of ${v.rooms[i].name} opens.`);
        } else if (open) setSay(`🌳 At ${v.rooms[i].name}, out in the open. Look around, or dig if you think it's buried here.`);
        else if (v.dug === v.rooms[i].id && !v.inner) setSay(`🏠 Inside ${v.rooms[i].name}. You've searched it: it's empty.`);
        else {
          const things = v.objects.filter((o) => o.room === v.rooms[i].id).map((o) => o.label.replace(/^(The|An|A) /, (w) => w.toLowerCase()));
          setSay(`🏠 Inside ${v.rooms[i].name}…${things.length ? ` You see ${things.join(", ")}: go up to one and look.` : ""}`);
        }
      }
      return true;
    };
  });

  const built = !!view && uid !== null;
  useEffect(() => {
    const v = viewRef.current;
    const el = host.current;
    if (!built || !v || !el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const kw = buildKeyWorld(v.rooms, v.objects, v.scene, v.title, `${uidRef.current}:${v.key}`);
    kw.setDark(!torchRef.current);
    const world = new THREE.Scene();
    const sky = new THREE.Color(kw.sky);
    world.background = sky;
    // The view is kept short (owner: "we just limit the viewing so it is not too big"): the town fades into the haze
    const fog = new THREE.Fog(sky.clone(), 26, 64);
    world.fog = fog;
    const hemi = new THREE.HemisphereLight("#FFF4E0", "#667755", 2.0);
    world.add(hemi);
    const sun = new THREE.DirectionalLight("#FFFFFF", 1.3);
    sun.position.set(20, 40, 10);
    world.add(sun);
    world.add(kw.group);
    // The time of day at the key's place (owner, 3 Nov 2026: "the day time we got there should be the time that is in
    // the key world"): where the sun really is there now; at night the lamps glow and a little light goes with the hunter
    const glow = new THREE.PointLight("#FFE2A8", 0, 10, 1.5);
    world.add(glow);
    const daySky = new THREE.Color(kw.sky), nightSky = new THREE.Color("#0B1330"), duskSky = new THREE.Color("#E8955A");
    let night = 0;
    const tellTime = () => {
      const { elevation, azimuth } = sunAt(v.at.lat, v.at.lng);
      const day = daylight(elevation);
      night = 1 - day;
      const dusk = Math.max(0, 1 - Math.abs(elevation - 1) / 7) * 0.45; // a warm sky as the sun sits on the horizon
      sky.copy(nightSky).lerp(daySky, day).lerp(duskSky, dusk * day);
      fog.color.copy(sky);
      hemi.intensity = 0.35 + 1.65 * day;
      sun.intensity = 1.3 * day;
      sun.color.set(dusk > 0.1 ? "#FFC890" : "#FFFFFF");
      const el2 = Math.max(8, elevation) * (Math.PI / 180), az = azimuth * (Math.PI / 180);
      sun.position.set(Math.sin(az) * Math.cos(el2) * 50, Math.sin(el2) * 50, -Math.cos(az) * Math.cos(el2) * 50);
      kw.setNight(night);
      el.parentElement?.setAttribute("data-daylight", day.toFixed(2)); // tests read it
    };
    tellTime();
    const clock = window.setInterval(tellTime, 30_000);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    let lockArrowAt = 0;
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.fov = w < h ? 64 : 50; // a tall phone screen sees as much of the street across as a computer's
      camera.updateProjectionMatrix();
      const root = el.parentElement;
      root?.style.setProperty("--house-head", `${root?.querySelector<HTMLElement>("[data-house-head]")?.offsetHeight ?? 0}px`);
      root?.style.setProperty("--house-foot", `${root?.querySelector<HTMLElement>("[data-house-foot]")?.offsetHeight ?? 0}px`);
    };
    fit();
    const sizes = new ResizeObserver(() => fit());
    sizes.observe(el);
    for (const bar of el.parentElement?.querySelectorAll("[data-house-head], [data-house-foot]") ?? []) sizes.observe(bar);

    // The hunter, at the edge of the square (or in the place they were in)
    const av = buildAvatar(look);
    av.root.scale.setScalar(AVATAR);
    av.root.position.set(kw.start.x, 0.1, kw.start.z);
    av.root.rotation.y = Math.PI; // facing the square
    world.add(av.root);
    // The metal detector, held out in the right hand: a handle, a pole down to a round head just off the ground
    const wand = new THREE.Group();
    const head = new THREE.MeshLambertMaterial({ color: "#2B2F36", emissive: new THREE.Color("#000000") });
    {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 8), new THREE.MeshLambertMaterial({ color: "#9AA3AD" }));
      pole.position.set(0, -0.55, 0.62);
      pole.rotation.x = 0.95; // leaning forward and down
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), new THREE.MeshLambertMaterial({ color: "#1F2328" }));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20), head);
      disc.position.set(0, -1.13, 1.24);
      const box3 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.2), new THREE.MeshLambertMaterial({ color: "#F4B41A" }));
      box3.position.set(0, -0.2, 0.25);
      wand.add(pole, grip, disc, box3);
    }
    wand.position.set(0.42, 1.25, 0.25); // at the right hand, in the hunter's own frame
    wand.visible = false;
    av.root.add(wand);
    // The street just outside each place's way in (tests walk there to read the detector from the street)
    el.parentElement?.setAttribute("data-fronts", JSON.stringify(Object.fromEntries(kw.places.map((p) => [p.id, [p.front.x, p.front.z]]))));
    // …and where to stand to look at each thing in a place
    el.parentElement?.setAttribute("data-things", JSON.stringify(Object.fromEntries(v.objects.map((o) => [o.id, kw.objectSpot(o.id)]).filter(([, p]) => p).map(([k, p]) => [k, [(p as Point).x, (p as Point).z]]))));
    let handled = -1; // the place whose going-in the game has dealt with
    if (v.room) {
      const i = v.rooms.findIndex((r) => r.id === v.room);
      if (i >= 0) {
        av.root.position.set(kw.places[i].inside.x, 0.1, kw.places[i].inside.z);
        handled = i;
      }
    }
    // The key's chest, if the right place is found already; every box, shut or opened
    const dugAt = v.rooms.findIndex((r) => r.id === v.dug);
    if (dugAt >= 0 && v.rooms[dugAt].chest) kw.setKey(dugAt);
    kw.setBoxes(v.inner ?? null);
    let lastHome = -1;
    let path: Point[] = [];
    let arrive: (() => void) | null = null;
    let shakeUntil = 0;
    const walkTo = (p: Point[]) =>
      new Promise<void>((resolve) => {
        arrive?.();
        path = p.slice();
        arrive = resolve;
      });

    // Arrow keys / WASD: up the screen is away from the camera.
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      // Enter, E or Space: the action button's action (pick up, open, try the lock)
      if (e.type === "keydown" && !e.repeat && (e.code === "Enter" || e.code === "KeyE" || e.code === "Space") && (e.target as HTMLElement)?.tagName !== "INPUT" && actionRef.current && !roomPuzzleRef.current) {
        e.preventDefault();
        doActionRef.current();
        return;
      }
      const k = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" }[e.code];
      if (!k || (e.target as HTMLElement)?.tagName === "INPUT") return;
      e.preventDefault();
      if (e.type === "keydown") keys.add(k);
      else keys.delete(k);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    // Trap animations (owner, 31 Oct 2026: like the movies): each runs for a second or so; true when done.
    const fx: ((t: number) => boolean)[] = [];
    const flicker = new THREE.Color("#3A0A0A");
    const soft = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const trap = (kind: string, i: number) => {
      const t0 = performance.now();
      const a = kw.places[i]?.area ?? { x0: -2, x1: 2, z0: -2, z1: 2 };
      const room = { x: (a.x0 + a.x1) / 2, z: (a.z0 + a.z1) / 2, w: a.x1 - a.x0, d: a.z1 - a.z0 };
      const me = av.root.position.clone();
      const ease = (t: number) => Math.min(1, Math.max(0, (t - t0) / 1000));
      shakeUntil = t0 + 900;
      if (kind === "collapse" || kind === "fall") {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.02, 24), soft("#050505", 0.95));
        hole.position.set(me.x, 0.15, me.z);
        world.add(hole);
        fx.push((t) => {
          const k = ease(t);
          hole.scale.setScalar(Math.min(1, k * 3));
          if (k > 0.3) av.root.position.y = 0.1 - (k - 0.3) * 4;
          return k >= 1;
        });
      } else if (kind === "flood") {
        const water = new THREE.Mesh(new THREE.BoxGeometry(room.w, 1, room.d), soft("#2E7FBF", 0.55));
        water.position.set(room.x, 0, room.z);
        world.add(water);
        fx.push((t) => {
          const k = ease(t);
          water.scale.y = 0.05 + k * 1.6;
          water.position.y = (0.05 + k * 1.6) / 2;
          return k >= 1;
        });
      } else if (kind === "smoke" || kind === "gas" || kind === "fire") {
        const color = kind === "gas" ? "#7FBF5E" : kind === "fire" ? "#F07A28" : "#B9B9B9";
        const puffs = Array.from({ length: 9 }, (_, j) => {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), soft(color, 0.6));
          puff.position.set(me.x + Math.cos(j) * 0.4, 0.5 + (j % 3) * 0.4, me.z + Math.sin(j) * 0.4);
          world.add(puff);
          return puff;
        });
        fx.push((t) => {
          const k = ease(t);
          puffs.forEach((p, j) => {
            p.scale.setScalar(1 + k * 3);
            p.position.y += 0.01 * (j % 3 + 1);
            (p.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k * 0.5);
          });
          return k >= 1;
        });
      } else if (kind === "darts" || kind === "swarm") {
        const bits = Array.from({ length: 14 }, (_, j) => {
          const b = new THREE.Mesh(kind === "darts" ? new THREE.BoxGeometry(0.05, 0.05, 0.35) : new THREE.SphereGeometry(0.09, 6, 4), soft(kind === "darts" ? "#C8A45C" : "#1A1A1A", 1));
          b.position.set(me.x + (j % 5 - 2) * 0.6, 1 + (j % 3) * 0.3, me.z - 3);
          b.userData.from = b.position.clone();
          world.add(b);
          return b;
        });
        fx.push((t) => {
          const k = ease(t);
          bits.forEach((b, j) => {
            const kk = Math.min(1, k * 1.4 - j * 0.03);
            if (kk > 0) b.position.lerpVectors(b.userData.from as THREE.Vector3, new THREE.Vector3(me.x, 1.1 + Math.sin(j) * 0.2, me.z), kk);
            b.lookAt(me.x, 1.1, me.z);
          });
          return k >= 1;
        });
      } else if (kind === "net" || kind === "cage") {
        const net = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 1.4), new THREE.MeshBasicMaterial({ color: kind === "cage" ? "#3A3A3A" : "#C9B27E", wireframe: true }));
        net.position.set(me.x, 5, me.z);
        world.add(net);
        fx.push((t) => {
          const k = ease(t);
          net.position.y = Math.max(1.1, 5 - k * 8);
          return k >= 1;
        });
      } else if (kind === "boulder") {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 1), new THREE.MeshLambertMaterial({ color: "#7E7A70" }));
        rock.position.set(me.x, 0.9, me.z - 4);
        const from = rock.position.clone();
        world.add(rock);
        fx.push((t) => {
          const k = ease(t);
          rock.position.lerpVectors(from, new THREE.Vector3(me.x, 0.9, me.z), Math.min(1, k * 1.2));
          rock.rotation.x -= 0.15;
          return k >= 1;
        });
      } else {
        // The Masquerade, a mirror, a storm, a snake: the light flickers
        fx.push((t) => {
          const k = ease(t);
          world.background = Math.floor(k * 12) % 2 && k < 1 ? flicker : sky;
          return k >= 1;
        });
      }
    };

    let zoom = el.clientWidth > el.clientHeight ? ZOOM.laptop : ZOOM.phone;
    // The camera's own turn: it swings round behind the hunter as they turn; a drag looks round (as on the map)
    let yaw = av.root.rotation.y;
    let lookAround = 0;
    const behind = (r: number, back: number, up: number, at: { x: number; z: number }) => new THREE.Vector3(at.x - Math.sin(r) * back, up, at.z - Math.cos(r) * back);
    const eye = behind(yaw, EYE.street.back * zoom, EYE.street.up * zoom, av.root.position);
    const aim = new THREE.Vector3().copy(av.root.position);
    camera.position.copy(eye);
    let raf = 0;
    let last = performance.now();
    let lastShown = 0;
    let shownHere = -2;
    let lastNear = -2;
    let lastRange = ""; // the places the detector could read, last time
    let stepping = false;
    let lastHand = ""; // what the action button was last set to
    const ghosts = new Map<string, ReturnType<typeof buildAvatar>>(); // the other hunters drawn
    let lastSent = 0;
    let lastTold = 0;
    let told = { x: 0, z: 0, in: false };
    let lastBeep = 0;
    let lastCount = 0;
    let sent = { x: 0, z: 0, in: false };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // a slow phone still walks at full speed (a step stays thinner than a wall)
      last = now;
      for (let j = fx.length - 1; j >= 0; j--) if (fx[j](now)) fx.splice(j, 1);
      let moved = 0;
      // Steering (the joystick or the keys): it takes over from a walk to a tapped spot.
      const stick = joy.current;
      const steering = keys.size > 0 || Math.hypot(stick.x, stick.y) > 0;
      const frozen = busyRef.current || !!roomPuzzleRef.current || !!diggingRef.current; // digging: on the spot
      if (steering && path.length && !frozen) {
        path = [];
        const done = arrive;
        arrive = null;
        done?.();
      }
      const me = av.root.position;
      const next = path[0];
      if (next && !roomPuzzleRef.current) {
        const dx = next.x - me.x, dz = next.z - me.z;
        const d = Math.hypot(dx, dz);
        const step = SPEED * dt;
        if (d <= step) {
          me.x = next.x;
          me.z = next.z;
          path.shift();
          moved = d;
          if (!path.length) {
            const done = arrive;
            arrive = null;
            done?.();
          }
        } else {
          me.x += (dx / d) * step;
          me.z += (dz / d) * step;
          av.root.rotation.y = Math.atan2(dx, dz);
          moved = step;
        }
      } else if (steering && !frozen && !stepping) {
        // As on the map: forward and back walk the way the hunter faces, left and right turn them (the keys at full
        // speed; the joystick as far as it's pushed)
        let ahead = 0, turn = 0;
        if (keys.size) {
          ahead = (keys.has("u") ? 1 : 0) - (keys.has("d") ? 1 : 0);
          turn = (keys.has("l") ? 1 : 0) - (keys.has("r") ? 1 : 0);
        } else {
          // Gentler (owner, 7 Nov 2026: "it is too sensitive"): a thumb pushed mostly ahead walks straight, and turning
          // eases in, slow near the middle and STICK_TURN only at the edge
          ahead = -stick.y;
          const side = Math.abs(stick.x) < 0.2 || Math.abs(stick.x) < 0.45 * Math.abs(stick.y) ? 0 : (Math.abs(stick.x) - 0.2) / 0.8;
          turn = -Math.sign(stick.x) * side * side * (STICK_TURN / TURN);
        }
        av.root.rotation.y += turn * TURN * dt;
        if (ahead) {
          const r = av.root.rotation.y;
          const step = Math.max(-0.6, Math.min(1, ahead)) * SPEED * dt; // backwards a little slower
          const sx = Math.sin(r) * step, sz = Math.cos(r) * step;
          const from = { x: me.x, z: me.z };
          // Straight on, or sliding along a wall
          const to = [{ x: from.x + sx, z: from.z + sz }, { x: from.x + sx, z: from.z }, { x: from.x, z: from.z + sz }].find((t) => !kw.blocked(t));
          if (to) {
            moved = Math.hypot(to.x - from.x, to.z - from.z);
            me.x = to.x;
            me.z = to.z;
          }
        }
      }
      animateAvatar(av, { mode: "walk", phase: "idle", moving: moved > 0 ? 1 : 0, distance: moved / AVATAR }, dt, now / 1000);
      if (moved > 0) lookAround *= Math.exp(-1.2 * dt); // walking on, the view swings back behind the hunter
      // The detector: held out in front, swept side to side; its head glows red near the key's place, blue elsewhere
      wand.visible = detectorRef.current;
      if (wand.visible) {
        av.armR.rotation.x = -0.75;
        av.armR.rotation.z = 0;
        wand.rotation.y = Math.sin(now / 1000 * (moved > 0 ? 3 : 1.6)) * 0.45;
        const hot = wandHeatRef.current === "hot", cold = wandHeatRef.current === "cold";
        // Near the key's place: a beep, faster and higher the closer (every 0.18 s at its door, 1.4 s at 20 m)
        const k = hotRef.current;
        const area = k >= 0 ? kw.places[k]?.area : null;
        const away = area ? Math.hypot(Math.max(area.x0 - me.x, 0, me.x - area.x1), Math.max(area.z0 - me.z, 0, me.z - area.z1)) : Infinity;
        const puzzling = !!roomPuzzleRef.current || trialOnRef.current; // quiet while a puzzle is being done
        if (away < BEEP_M && !puzzling) {
          const close = 1 - away / BEEP_M;
          if (now - lastBeep > 180 + (1 - close) * 1220) {
            lastBeep = now;
            cue("beep", close);
          }
        }
        const flash = away < BEEP_M ? Math.max(0, 1 - (now - lastBeep) / 160) : 0;
        const pulse = hot ? 0.55 + 0.45 * Math.sin(now / 90) : flash > 0 ? flash : cold ? 0.35 : 0;
        head.emissive.set(hot || flash > 0 ? "#FF2A2A" : cold ? "#2F6FEB" : "#000000").multiplyScalar(pulse);
        if (away < BEEP_M) el.parentElement?.setAttribute("data-beep", String(Math.round(away))); // tests read it
      }
      el.parentElement?.setAttribute("data-wand", wand.visible ? wandHeatRef.current || "on" : "off"); // tests read it

      const at = { x: me.x, z: me.z };
      if (now - lastShown > 250) {
        lastShown = now;
        el.parentElement?.setAttribute("data-at", `${at.x.toFixed(2)},${at.z.toFixed(2)}`); // where the hunter is (tests read it)
        el.parentElement?.setAttribute("data-heading", av.root.rotation.y.toFixed(2)); // which way they face (tests read it)
      }
      const v = viewRef.current;
      const here = kw.placeAt(at);
      if (here !== shownHere) {
        shownHere = here;
        setStanding(here);
        if (here >= 0 && wideRef.current) setWide(false);
      }
      // Going in (or out): the server hears of it, and walking into a building is searching it (owner: "we would
      // still have a trap if some enters the wrong house")
      if (here !== handled && !busyRef.current && !stepping) {
        handled = here;
        stepping = true;
        void enterRef.current(here).finally(() => (stepping = false));
      }
      // What's at hand for the action button: a box or the key's chest (its lock), a thing in this place (to look at,
      // or pick up), a locked door (to open with what it needs). Nothing happens by walking up: the button does it.
      const spots = kw.boxSpots();
      if (now - lastShown < 1) {
        el.parentElement?.setAttribute("data-boxes", JSON.stringify(spots)); // tests read it
        el.parentElement?.setAttribute("data-guide", String(kw.guide())); // the chain lock whose house is lit
      }
      let hand: Action | null = null;
      let handD = Infinity;
      for (const [key, spot] of Object.entries(spots)) {
        const n = Number(key);
        const d = dist(at, spot);
        if (d < 1.5 && d < handD && !v?.inner?.[n - 1]?.open) {
          handD = d;
          hand = { kind: "box", n, label: n === 1 ? (isDjinn ? "🔓 Try the vault's lock" : "🔓 Open the key's chest") : n === 7 && isDjinn ? "🔓 Try the last lock" : n >= 6 ? "🔓 Try the lock" : "🔓 Try the box's lock" };
        }
      }
      if (v && here >= 0) {
        for (const o of v.objects) {
          if (o.room !== v.rooms[here]?.id) continue;
          const spot = kw.objectSpot(o.id);
          const d = spot ? dist(at, spot) : Infinity;
          if (d < 1.6 && d < handD) {
            handD = d;
            hand = { kind: "thing", id: o.id, label: `✋ Look at ${o.label.replace(/^(The|An|A) /, (w) => w.toLowerCase())}` };
          }
        }
      }
      if (v && here < 0) {
        for (let i = 0; i < kw.places.length; i++) {
          const d = dist(at, kw.places[i].front);
          if (d < 2 && d < handD && v.rooms[i]?.locked) {
            handD = d;
            hand = { kind: "door", i, label: `🔑 Open ${v.rooms[i].name.replace(/^(The|An|A) /, (w) => w.toLowerCase())}` };
          }
        }
      }
      const handKey = hand ? `${hand.kind}:${hand.kind === "box" ? hand.n : hand.kind === "thing" ? hand.id : hand.i}` : "";
      if (handKey !== lastHand) {
        lastHand = handKey;
        setAction(hand);
      }
      // Into a small house: what's there (a box, or nothing at all)
      const home = kw.homeAt(at);
      if (home !== lastHome) {
        lastHome = home;
        if (home >= 0) setSay(kw.homeBox(home) ? "📦 Inside a house: a locked box at the back. Go up to it and try its lock." : "🏚 Inside a house: nothing here.");
        el.parentElement?.setAttribute("data-home", String(home)); // tests read it
      }
      // The detector, from the street too (owner, 3 Nov 2026: "the metal detector helps in locating where treasures are buried")
      let nearNow = here;
      if (nearNow < 0) {
        let best = NEAR_M;
        kw.places.forEach((p, k) => {
          const d = dist(at, p.front);
          if (d < best) {
            best = d;
            nearNow = k;
          }
        });
      }
      if (nearNow !== lastNear) {
        lastNear = nearNow;
        setNear(nearNow);
      }
      // The places close enough for the detector to read (only with one in hand)
      if (detectorRef.current) {
        const range = kw.places
          .map((p, k) => [k, Math.hypot(Math.max(p.area.x0 - at.x, 0, at.x - p.area.x1), Math.max(p.area.z0 - at.z, 0, at.z - p.area.z1))] as const)
          .filter(([, d]) => d < DETECT_M)
          .map(([k]) => k)
          .join(",");
        if (range !== lastRange) {
          lastRange = range;
          setInRange(range);
        }
      }

      // Where the hunter is, for the others here (a few times a second while walking; out of sight inside a place)
      const ch = channelRef.current;
      const inPlace = here >= 0 || home >= 0; // out of sight inside any house
      // Only over the open connection (never one web request each, should it drop)
      if (ch && ch.state === "joined" && now - lastSent > 250 && (now - lastSent > 2000 || dist(at, sent) > 0.05 || inPlace !== sent.in)) {
        lastSent = now;
        sent = { x: at.x, z: at.z, in: inPlace };
        void ch.send({ type: "broadcast", event: "pos", payload: { u: uidRef.current, x: +at.x.toFixed(2), z: +at.z.toFixed(2), r: +av.root.rotation.y.toFixed(2), in: inPlace } });
      }
      // …and for the broadcast (the map saves it as the scene's track)
      if (now - lastTold > 250 && (now - lastTold > 2000 || dist(at, told) > 0.05 || inPlace !== told.in)) {
        lastTold = now;
        told = { x: at.x, z: at.z, in: inPlace };
        tellShow("at", { x: +at.x.toFixed(2), z: +at.z.toFixed(2), r: +av.root.rotation.y.toFixed(2), in: inPlace });
      }
      // The others: the nearest few, walking where they are. Nobody is seen inside a place or digging, and nobody sees
      // what anyone finds (owner: "how do we handle users who are around and they saw a user dig a place and got the
      // treasure"); each hunter's places stand on lots of their own too.
      const shown = [...othersRef.current.entries()]
        .filter(([u, o]) => !o.in && now - o.seen < 8000 && looksRef.current.has(u))
        .sort((a, b) => dist(a[1], at) - dist(b[1], at))
        .slice(0, OTHERS_SHOWN);
      const keep = new Set(shown.map(([u]) => u));
      for (const [u, g] of ghosts) if (!keep.has(u)) g.root.visible = false;
      for (const [u, o] of shown) {
        let g = ghosts.get(u);
        if (!g) {
          g = buildAvatar(looksRef.current.get(u)!);
          g.root.scale.setScalar(AVATAR);
          g.root.position.set(o.x, 0.1, o.z);
          world.add(g.root);
          ghosts.set(u, g);
        }
        const p = g.root.position;
        if (!g.root.visible || dist(p, o) > 8) p.set(o.x, 0.1, o.z); // back in sight: where they are now
        const was = { x: p.x, z: p.z };
        const kk = 1 - Math.exp(-8 * dt);
        p.x += (o.x - p.x) * kk;
        p.z += (o.z - p.z) * kk;
        g.root.rotation.y = o.r;
        g.root.visible = true;
        const step = dist(p, was);
        animateAvatar(g, { mode: "walk", phase: "idle", moving: step > 0.002 ? 1 : 0, distance: step / AVATAR }, dt, now / 1000);
      }
      if (now - lastCount > 500) {
        lastCount = now;
        el.parentElement?.setAttribute("data-others-shown", String(keep.size)); // tests read it
      }
      // A little light goes with the hunter at night (more with a torch)
      glow.position.set(at.x, 2.6, at.z);
      glow.intensity = night * (torchRef.current ? 3.2 : 1.6);
      glow.distance = torchRef.current ? 15 : 9;

      // The camera: behind the hunter and a little above, swinging round as they turn (as the map's), the hunter in the
      // middle of the screen, as far out as zoomed; the haze starts a little beyond the hunter
      const k = 1 - Math.exp(-5 * dt);
      let d = av.root.rotation.y + lookAround - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, 4 * dt);
      const place = here >= 0 || kw.homeAt(at) >= 0 ? EYE.inside : EYE.street;
      const goal = wideRef.current ? EYE.wide.clone() : behind(yaw, place.back * zoom, place.up * zoom, at);
      const look = wideRef.current ? new THREE.Vector3(0, 0, 2) : new THREE.Vector3(at.x + Math.sin(yaw) * 1.5, 1.2, at.z + Math.cos(yaw) * 1.5);
      eye.lerp(goal, k);
      aim.lerp(look, k);
      const away = wideRef.current ? 100 : Math.hypot(place.back, place.up) * zoom;
      fog.near += ((wideRef.current ? 300 : away + 12) - fog.near) * k;
      fog.far += ((wideRef.current ? 400 : away + 50) - fog.far) * k;
      camera.position.copy(eye);
      if (now < shakeUntil) camera.position.x += (Math.random() - 0.5) * 0.4;
      camera.lookAt(aim);
      // Which way on the screen to the chain's next lock (its house lit gold): where it falls on the screen, from the
      // middle (behind the camera, the other way)
      if (now - lockArrowAt > 150) {
        lockArrowAt = now;
        const g = kw.guide();
        const spot = g ? kw.boxSpots()[g] : null;
        if (spot) {
          const p = new THREE.Vector3(spot.x, 1, spot.z).project(camera);
          const back = p.z > 1 ? -1 : 1;
          const turn = Math.round((Math.atan2(p.x * back, p.y * back) * 180) / Math.PI);
          const metres = Math.round(dist(at, spot));
          setToLock((o) => (o && o.n === g && Math.abs(o.turn - turn) < 4 && o.metres === metres ? o : { n: g, turn, metres }));
        } else setToLock((o) => (o ? null : o));
      }
      kw.tick(dt, at, { x: eye.x, y: eye.y, z: eye.z });
      renderer.render(world, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Taps: whatever was touched, if it's showing (with the spot on the ground)
    const ray = new THREE.Raycaster();
    const tapAt = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(kw.targets, true).find((h) => {
        for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false;
        return true;
      });
      const data = hit?.object.userData as { tap?: string; id?: string } | undefined;
      if (data?.tap) window.dispatchEvent(new CustomEvent("loota:house-tap", { detail: { tap: data.tap, id: data.id, x: hit!.point.x, z: hit!.point.z } }));
    };
    // A tap (a finger that hardly moved), or two fingers pinching to zoom
    let down: { x: number; y: number } | null = null;
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number } | null = null;
    const spread = () => {
      const [a, b] = [...fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onDown = (e: PointerEvent) => {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) {
        pinch = { d: spread(), zoom };
        down = null; // not a tap
      } else down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      const was = fingers.get(e.pointerId)!;
      if (fingers.size === 1 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 12) lookAround -= ((e.clientX - was.x) / Math.max(1, el.clientWidth)) * Math.PI * 1.4;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && fingers.size === 2) zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, (pinch.zoom * pinch.d) / Math.max(20, spread())));
    };
    const onUp = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) pinch = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tapAt(e);
      down = null;
    };
    // The mouse wheel (or a trackpad's two fingers) on a computer
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom * Math.exp(e.deltaY * 0.0012)));
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    scene.current = {
      world: kw,
      walkTo,
      at: () => ({ x: av.root.position.x, z: av.root.position.z }),
      shake: () => (shakeUntil = performance.now() + 700),
      trap,
    };
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(clock);
      sizes.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [built, look, isDjinn]);

  // A tap: walk there (round the walls); into a place, a room's door, a thing to touch, or the chest.
  useEffect(() => {
    const onTap = async (e: Event) => {
      const { tap, id, x, z } = (e as CustomEvent<{ tap: string; id?: string; x?: number; z?: number }>).detail;
      const s = scene.current;
      const v = viewRef.current;
      if (!s || !v || busyRef.current || dodge || roomPuzzleRef.current || diggingRef.current) return;
      const kw = s.world;
      if (tap === "chest") return void openRoomRef.current(1);
      if (tap === "ground" || tap === "hall") {
        if (x === undefined || z === undefined) return;
        await s.walkTo(kw.route(s.at(), { x, z }));
        return;
      }
      if (tap === "inner") {
        // A box (or the key's chest): walk up to it, and its lock
        const n = Number(id);
        const spot = kw.boxSpots()[n];
        if (!spot) return;
        await s.walkTo(kw.route(s.at(), spot));
        if (!roomPuzzleRef.current) await openRoomRef.current(n);
        return;
      }
      const roomId = tap === "room" ? id : v.objects.find((o) => o.id === id)?.room;
      const i = v.rooms.findIndex((r) => r.id === roomId);
      if (i < 0) return;
      const p = kw.places[i];
      if (tap === "room") {
        // A tap on a place: walk to it, and in (a locked one: up to its door)
        if (kw.placeAt(s.at()) === i && x !== undefined && z !== undefined) return void (await s.walkTo(kw.route(s.at(), { x, z })));
        await s.walkTo(kw.route(s.at(), v.rooms[i].locked ? p.front : p.inside));
        if (viewRef.current?.rooms[i]?.locked) await stepRef.current(i); // at a locked door: try it (with what it needs, if carried)
        return;
      }
      if (tap === "object" && id) {
        const spot = kw.objectSpot(id);
        if (spot) await s.walkTo(kw.route(s.at(), spot));
        if (kw.placeAt(s.at()) !== i) return setSay("You can't reach that from here.");
        await touchRef.current(id);
      }
    };
    window.addEventListener("loota:house-tap", onTap);
    return () => window.removeEventListener("loota:house-tap", onTap);
  }, [dodge, huntId, supabase]);

  /** Walked into a place: a building is searched as the hunter goes in; out in the open, they choose to dig. */
  useEffect(() => {
    enterRef.current = async (i: number) => {
      if (!(await stepRef.current(i))) return;
      const v = viewRef.current;
      const r = i >= 0 ? v?.rooms[i] : null;
      if (r && !r.outdoor && v?.dug !== r.id) await search(i);
    };
  });

  /** A room of the treasure building, its door walked up to: its puzzle opens (or, opened already, what it held). */
  const opening = useRef(false);
  async function openRoom(n: number) {
    const v = viewRef.current;
    if (!v?.inner || busyRef.current || opening.current || roomPuzzleRef.current) return;
    const cell = v.inner[n - 1];
    if (!cell) return;
    if (cell.open) return setSay(`${boxName(n)}: ${OUTCOME_SAID[cell.outcome ?? ""] ?? "opened already."}`);
    opening.current = true;
    setBusy(true);
    try {
      const res = await fetch(djinn ? "/api/djinn/room" : "/api/house/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(djinn ? { room: n } : { hunt: huntId, room: n }) });
      const r = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; kind?: string; puzzle?: unknown; open?: boolean; seconds?: number; secondsLeft?: number } | null;
      if (r?.reason === "jammed") return setSay(`⏳ ${boxName(n)}'s lock is jammed: try again in ${Math.max(1, Math.ceil(r.seconds ?? 30))} s.`);
      if (r?.reason === "not_inside") return setSay("Go back into the place with the vault first.");
      if (!r?.ok || !r.kind) return setSay(REFUSED[r?.reason ?? ""] ?? "The door won't budge right now.");
      setRoomNote(null);
      // Each puzzle's own time (owner, 8 Nov 2026: "add the right time to solving this if 60 secs is not right").
      const total = r.seconds ?? 60;
      const left = Math.max(1, Math.min(total, r.secondsLeft ?? total));
      setRoomLeft(left);
      setRoomPuzzle({ n, kind: r.kind, puzzle: r.puzzle, ends: Date.now() + left * 1000 });
      setSay(`🔒 ${boxName(n)} is locked by a puzzle: solve it in ${total} seconds to open it.`);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    doActionRef.current = () => {
      const a = actionRef.current;
      if (!a || busyRef.current) return;
      if (a.kind === "box") void openRoomRef.current(a.n);
      else if (a.kind === "thing") void touchRef.current(a.id);
      else void stepRef.current(a.i);
    };
  });

  useEffect(() => {
    openRoomRef.current = openRoom;
    // For the browser tests (development only): answer the open room's puzzle as its board would.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __lootaRoomSolve?: (a: unknown) => void }).__lootaRoomSolve = (ans) => void solveRoom(ans);
  });

  /** A room's puzzle, played to the end: the server checks it; right, the door opens on what it held. */
  async function solveRoom(answer: unknown) {
    const rp = roomPuzzle;
    const s = scene.current;
    const v = viewRef.current;
    if (!rp || !v || busyRef.current) return;
    setBusy(true);
    setRoomNote(null); // the last try's word goes as this one is checked
    try {
      const res = await fetch(djinn ? "/api/djinn/room/solve" : "/api/house/room/solve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(djinn ? { room: rp.n, answer } : { hunt: huntId, room: rp.n, answer }) });
      const r = (await res.json().catch(() => null)) as Opened | null;
      if (r?.reason === "late") {
        tellShow("result", { n: rp.n, late: true });
        setRoomPuzzle(null);
        return setSay(`⏳ Too slow: ${boxName(rp.n)}'s lock jams for 30 s. Then it has a new puzzle.`);
      }
      if (!r?.ok) return setRoomNote(REFUSED[r?.reason ?? ""] ?? "Something went wrong. Try again.");
      if (!r.right) {
        tellShow("result", { n: rp.n, right: false });
        setRoomShake((k) => k + 1);
        // How many are right, for a puzzle of questions (owner, 9 Nov 2026: "it said all the answers are wrong")
        const some = r.rightOf ? (r.rightOf.right > 0 ? ` ${r.rightOf.right} of ${r.rightOf.of} are right.` : " None are right yet.") : "";
        return setRoomNote(`Not quite: the lock doesn't turn.${some} Look again.`);
      }
      tellShow("result", { n: rp.n, right: true, outcome: r.outcome ?? null });
      setRoomPuzzle(null);
      const inner = (v.inner ?? []).map((c) => (c.n === rp.n ? { ...c, open: true, outcome: r.outcome ?? null } : c));
      setView((old) => (old ? { ...old, inner } : old));
      const here = v.rooms.findIndex((room) => room.id === v.dug);
      s?.world.setBoxes(inner);
      if (r.outcome === "coins") {
        setSay(`💰 ${boxName(rp.n)}: a pile of coins! +${r.coins ?? 25}.`);
        if (r.balance != null) {
          onCoins?.(r.balance);
          setMe((m) => (m ? { ...m, coins: Number(r.balance) } : m));
        }
      } else if (r.outcome === "chapter") {
        setSay(`📜 ${boxName(rp.n)}: a page of the story! Chapter ${r.chapter ?? ""} is open on your scroll.`);
        window.dispatchEvent(new Event("loota:story-open"));
      } else if (r.outcome === "lock") {
        // A lock of the chain: its note sends the hunter on to the next (owner, 12 Nov 2026: "from 1 to another, another
        // to look for the next puzzle to another house, then they get the key")
        setSay(`🔓 Lock ${r.lock ?? (rp.n === 1 ? 1 : 2)} of 3 opens! Inside, a note: "The next lock is in a small house of this town." Its house is lit with a gold light: follow it.`);
      } else if (r.outcome === "wonder") {
        setSay(`🧞 The last lock turns and the vault opens: the Djinn bows. This was the true place! The Wonder is yours.`);
        window.setTimeout(() => djinn?.onVault({ outcome: "wonder", place: r.place, wonder: r.wonder, extraWonder: r.extraWonder }), 2200);
      } else if (r.outcome === "empty" || r.outcome === "too_late") {
        setSay(
          r.outcome === "empty"
            ? `🧞 The last lock turns… and the vault is empty. The Djinn laughs: this was a false place. The Wonder was never here.`
            : `🧞 The vault is open… and empty: another hunter took the Wonder first.`,
        );
        window.setTimeout(() => djinn?.onVault({ outcome: r.outcome!, place: r.place }), 2600);
      } else if (r.outcome === "dust") {
        setSay(`🏜 ${boxName(rp.n)}: only sand. The Djinn's joke.`);
      } else if (r.outcome === "key") {
        setSay(`🗝 ${boxName(rp.n)}: the key!`);
        window.setTimeout(() => onKey?.(r.award), 1500);
      } else if (r.penalty) {
        const pen = r.penalty;
        setSay(r.outcome === "decoy" ? `💀 ${boxName(rp.n)}: a chest… it's a fake!` : `⚠️ ${boxName(rp.n)}: a trap!`);
        if (here >= 0) s?.trap(pen.scene, here);
        window.setTimeout(() => onPenalty(pen), 1300);
      } else setSay(`${boxName(rp.n)}: ${OUTCOME_SAID[r.outcome ?? ""] ?? "empty."}`);
    } finally {
      setBusy(false);
    }
  }

  // A room's time (its own, by kind and level: owner, 8 Nov 2026): out of time, the lock jams for 30 s.
  useEffect(() => {
    if (!roomPuzzle) return;
    const n = roomPuzzle.n;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((roomPuzzle.ends - Date.now()) / 1000));
      setRoomLeft(left);
      if (left > 0) return;
      window.clearInterval(t);
      tellShow("result", { n, late: true });
      setRoomPuzzle((p) => (p?.n === n ? null : p));
      setSay(`⏳ Too slow: ${boxNameOf(n, isDjinn)}'s lock jams for 30 s. Then it has a new puzzle.`);
    }, 250);
    return () => window.clearInterval(t);
  }, [roomPuzzle, isDjinn]);

  // The detector: once at each place, how hot it is (only with one; the server never says which is right). It reads
  // the place stood in, or from the street the one whose way in is close.
  useEffect(() => {
    const v = viewRef.current;
    const room = near >= 0 ? v?.rooms[near]?.id : null;
    if (!room || heatAsked.current.has(room) || isDjinn) return;
    heatAsked.current.add(room);
    void supabase.rpc("house_detect", { p_hunt: huntId, p_room: room }).then(({ data }) => {
      const d = data as { ok: boolean; reason?: string; heat?: string } | null;
      setHeat((h) => ({ ...h, [room]: d?.ok && d.heat ? d.heat : d?.reason === "no_detector" ? "none" : "" }));
    });
  }, [near, huntId, supabase, heard, isDjinn]);
  // …and with a detector, each place as the hunter comes near it (within DETECT_M): it beeps as they near the hot one
  // (owner, 4 Nov 2026), but only once they've walked close enough to read it (8 Nov 2026: "walk around before seeing it")
  useEffect(() => {
    const v = viewRef.current;
    if (!me?.detector || !v || !inRange || isDjinn) return;
    for (const r of inRange.split(",").map((k) => v.rooms[Number(k)]).filter(Boolean)) {
      if (heatAsked.current.has(r.id)) continue;
      heatAsked.current.add(r.id);
      void supabase.rpc("house_detect", { p_hunt: huntId, p_room: r.id }).then(({ data }) => {
        const d = data as { ok: boolean; heat?: string } | null;
        if (d?.ok && d.heat) setHeat((h) => ({ ...h, [r.id]: d.heat! }));
        else heatAsked.current.delete(r.id); // ask again later (not at the place yet)
      });
    }
  }, [inRange, me?.detector, view?.key, huntId, supabase, heard, isDjinn]);

  /** Searching a place (a building, as the hunter walks in; open ground, with ⛏ Dig here): the server decides (a
   * trap's challenge, nothing, the treasure building's rooms, or a buried chest). */
  async function search(i: number) {
    const s = scene.current;
    const v = viewRef.current;
    if (!s || !v || i < 0) return;
    setBusy(true);
    try {
      const { data } = await call("enter", { room: v.rooms[i].id });
      const r = data as Dug | null;
      if (!r?.ok) {
        if (r?.reason === "digging") {
          // Not dug long enough yet (by hand): carry on digging
          setDigLeft(r.seconds ?? 60);
          setDigging({ i, ends: Date.now() + (r.seconds ?? 60) * 1000 });
          return;
        }
        if (r?.reason === "out") setSay(`Catch your breath first: ${Math.max(1, Math.ceil((Date.parse(r.until ?? "") - Date.now()) / 1000))} s.`);
        else setSay(REFUSED[r?.reason ?? ""] ?? "Nothing happens here.");
        return;
      }
      if (r.locked) return setSay(`🔒 ${v.rooms[i].name}: ${r.text}`);
      const open = v.rooms[i].outdoor === true;
      if (r.trap && r.dodge) {
        s.shake();
        const what = djinn ? "The Djinn's vault" : "The key";
        setSay(open ? `⚠️ Your spade hits something that clicks… a trap! ${what} isn't here.` : `⚠️ Something clicks under your foot… a trap! ${what} isn't here.`);
        setDodge({ room: i, ...r.dodge });
        return;
      }
      if (r.trap && r.penalty) {
        const pen = r.penalty;
        s.trap(pen.scene, i);
        setSay(`⚠️ ${v.rooms[i].name} was a trap: the key isn't here. Your chapter's hint says where to look.`);
        setTimeout(() => onPenalty(pen), 1800);
        return;
      }
      const next = { ...v, ...(r as QuarterView) };
      setView(next);
      const found = next.rooms.findIndex((room) => room.chest);
      if (found >= 0) {
        // The right place: the key's chest, locked by a puzzle (room 1)
        s.world.setKey(found);
        s.world.setBoxes(next.inner ?? null);
        setSay(
          djinn
            ? "🧞 This is it: the Djinn's vault! Its first lock is a timed puzzle. Go up to it and open it (three locks in all)."
            : next.rooms[found].outdoor
              ? "⛏ Your spade hits wood: the key's chest! Go up to it and open it: its lock is a timed puzzle."
              : "🔍 This is it! The key's chest is here, locked by a timed puzzle. Go up to it and open it.",
        );
      } else setSay(open ? `⛏ You dig at ${v.rooms[i].name}… only earth. It isn't here.` : `🏠 Inside ${v.rooms[i].name}… nothing here. It's empty.`);
    } finally {
      setBusy(false);
    }
  }

  // The challenge: one answer, in time (the server knows the right one and the time).
  const answering = useRef(false);
  async function answer(choice: number) {
    const d = dodge;
    const s = scene.current;
    if (!d || answering.current) return;
    answering.current = true;
    setDodge(null);
    try {
      const { data } = await call("dodge", { choice });
      const r = data as { ok: boolean; dodged?: boolean; penalty?: Penalty & { balance: number | null; energy: number | null } } | null;
      const name = viewRef.current?.rooms[d.room]?.name ?? "this place";
      if (r?.dodged) {
        setSay(`💨 You dodged it! You jump clear of ${name}. It's a trap, though: ${djinn ? "the vault" : "the key"}'s not there.`);
        if (s) await s.walkTo(s.world.route(s.at(), s.world.places[d.room].front));
      } else if (r?.penalty) {
        const pen = r.penalty;
        s?.trap(pen.scene, d.room);
        setSay(choice === 0 ? "Too slow…" : "Wrong!");
        setTimeout(() => onPenalty(pen), 1300);
      }
    } finally {
      answering.current = false;
    }
  }
  // Out of time: the trap springs (0 is never the answer).
  useEffect(() => {
    if (!dodge) return;
    const t = setTimeout(() => void answer(0), dodge.seconds * 1000);
    return () => clearTimeout(t);
    // The timer belongs to this challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dodge]);

  const on = view && standing >= 0 ? view.rooms[standing] : null;
  const canDig = !!on?.outdoor && !busy && !dodge && !roomPuzzle && !digging && view?.dug !== on.id;
  const read = view && near >= 0 ? view.rooms[near] : null;
  const reading = read ? HEAT[heat[read.id] ?? ""] : null;
  const wandHeat = read ? heat[read.id] ?? "" : "";
  const hotAt = view ? view.rooms.findIndex((r) => heat[r.id] === "hot") : -1;
  useEffect(() => {
    hotRef.current = hotAt;
  }, [hotAt]);
  useEffect(() => {
    wandHeatRef.current = wandHeat; // the detector's head glows with it
  }, [wandHeat]);
  const readingOf = read && standing < 0 ? read.name : "";
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 bg-[#1B2230] text-paper" role="dialog" aria-modal="true" aria-label={djinn ? "The Djinn's ground" : "The key's place"} data-djinn={djinn ? "true" : undefined} data-busy={busy} data-inside={on?.id ?? ""} data-me={uid ?? ""}>
      {/* The world fills the screen; the bars float over it. */}
      <div ref={host} className="absolute inset-0 touch-none" data-house />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#1B2230]/85 via-[#1B2230]/50 to-transparent pb-3" data-house-head>
        <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">{djinn ? "🧞 The Djinn's Wager" : `Key ${view?.key ?? ""}`}</p>
            <h2 className="truncate font-display text-xl font-extrabold">{view?.title ?? "The key's place"}</h2>
          </div>
          {toLock && !roomPuzzle && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-gold px-2.5 py-1 text-xs font-extrabold text-ink" aria-label={`To the next lock: ${toLock.metres} m`} data-to-lock={toLock.n}>
              <span aria-hidden="true" className="inline-block" style={{ transform: `rotate(${toLock.turn}deg)` }}>⬆</span>
              Lock {toLock.n === 6 ? 2 : 3} · {toLock.metres} m
            </span>
          )}
          {reading && (
            <span
              className={`max-w-[45%] truncate rounded-full px-2.5 py-1 text-xs font-extrabold ${reading.style}`}
              aria-label={`Metal detector: ${reading.text}`}
              data-detector={heat[read?.id ?? ""]}
              data-detector-at={read?.id}
            >
              {reading.text}
              {readingOf ? ` · ${readingOf}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            aria-label={wide ? "Back to where you are" : "See the whole place"}
            title={wide ? "Back to where you are" : "See the whole place"}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line bg-[#1B2230]/70 text-lg"
          >
            {wide ? "🔍" : "🗺️"}
          </button>
          <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-xl border-[1.5px] border-line bg-[#1B2230]/70 px-3 text-sm font-bold">
            Leave
          </button>
        </div>
        {/* Coins, the hunters here, the story, the bag (owner, 3 Nov 2026: "show all the inventory and coin… they should
            be able to reference the scroll, see the number users who are around") */}
        <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2">
          <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#1B2230]/75 px-3 text-sm font-extrabold ring-1 ring-line" aria-label="Your coins" data-coins={me?.coins ?? ""}>
            🪙 {me ? me.coins.toLocaleString() : "…"}
          </span>
          <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#1B2230]/75 px-3 text-sm font-extrabold ring-1 ring-line" aria-label={`${othersHere} other hunters here`} data-others={othersHere}>
            👥 {othersHere}
          </span>
          {onScroll && (
            <button type="button" onClick={onScroll} aria-label="The story" className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#1B2230]/75 px-3 text-sm font-extrabold ring-1 ring-line">
              📜 Story
            </button>
          )}
          <button type="button" onClick={() => void openBag()} aria-label="Your bag" className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#1B2230]/75 px-3 text-sm font-extrabold ring-1 ring-line">
            🎒 Bag
          </button>
          {view?.items.map((it) => (
            <span key={it.id} className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-ink-2 px-3 text-xs font-bold ring-1 ring-line" aria-label={`Carrying ${it.name}`}>
              <span aria-hidden="true">{it.icon}</span>
              {it.name}
            </span>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-3 top-[calc(var(--house-head,5rem)+0.25rem)] flex flex-col gap-3">
        {dodge && (
          <div className="pointer-events-auto flex flex-col gap-3 rounded-2xl bg-ink/95 p-4 shadow-xl ring-2 ring-danger" role="alertdialog" aria-label="Dodge the trap">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-danger-text">A trap! Dodge it</p>
            <p className="font-display text-xl font-extrabold">{dodge.prompt}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="loota-dodge-bar h-full bg-danger" style={{ animationDuration: `${dodge.seconds}s` }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {dodge.options.map((o, j) => (
                <button key={j} type="button" onClick={() => void answer(j + 1)} className="h-12 rounded-xl bg-ink-2 text-lg font-bold ring-1 ring-line active:bg-gold active:text-ink">
                  {o.trim()}
                </button>
              ))}
            </div>
          </div>
        )}
        {roomPuzzle && (
          <div className="pointer-events-auto flex max-h-[70dvh] flex-col gap-2 overflow-y-auto rounded-2xl bg-ink/95 p-3 shadow-xl ring-2 ring-gold" role="dialog" aria-label={boxName(roomPuzzle.n)} data-room-puzzle={roomPuzzle.n}>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-xs font-extrabold uppercase tracking-[0.2em] text-gold">
                {boxName(roomPuzzle.n)} · {PUZZLE_NAMES[roomPuzzle.kind as keyof typeof PUZZLE_NAMES]?.name ?? "A puzzle"}
              </p>
              <span className={`rounded-full px-2 py-0.5 font-mono text-sm font-extrabold tabular-nums ${roomLeft <= 10 ? "bg-danger text-white" : "bg-ink-2 text-gold"}`} aria-label={`${roomLeft} seconds left`} data-room-left={roomLeft}>
                ⏱ {roomLeft}s
              </span>
              <button type="button" onClick={() => setRoomPuzzle(null)} className="h-8 rounded-lg border border-line px-2 text-xs font-bold" aria-label="Close the puzzle">
                Later
              </button>
            </div>
            <p className="text-xs text-paper/80">{PUZZLE_NAMES[roomPuzzle.kind as keyof typeof PUZZLE_NAMES]?.rule}</p>
            {/* The rooms are dark: without a torch the board is dim (owner, 3 Nov 2026: a torch "lights dark rooms") */}
            <div key={`${roomPuzzle.n}:${JSON.stringify(roomPuzzle.puzzle)}`} className={`mx-auto w-full max-w-[min(100%,24rem)] ${roomShake ? (roomShake % 2 ? "loota-shake" : "loota-shake-again") : ""} ${me?.torch ? "" : "brightness-[0.45] contrast-[0.8]"}`} data-dark={me?.torch ? "false" : "true"}>
              <AnswerMirror.Provider value={answerMirror}>
              <PuzzleBoard
                kind={roomPuzzle.kind}
                puzzle={roomPuzzle.puzzle}
                disabled={busy}
                onDone={(a) => void solveRoom(a)}
                onProgress={(p) => {
                  if (Math.abs(p - lastProgress.current) < 0.05 && p < 1) return;
                  lastProgress.current = p;
                  tellShow("progress", Math.round(p * 100) / 100);
                }}
              />
              </AnswerMirror.Provider>
            </div>
            {!me?.torch && (
              <div className="flex items-center gap-2 rounded-lg bg-ink-2 px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1">🔦 It&apos;s dark in here. A torch lights the room.</span>
                <button type="button" disabled={!!buying} onClick={() => void buy("torch")} className="h-8 shrink-0 rounded-lg bg-gold px-2 font-bold text-ink disabled:opacity-60">
                  Buy · 60
                </button>
              </div>
            )}
            {roomNote && (
              <p role="status" className="rounded-lg bg-danger/20 px-2 py-1 text-center text-sm font-bold">
                {roomNote}
              </p>
            )}
          </div>
        )}
        {digging && (
          <div className="pointer-events-auto flex flex-col gap-2 rounded-2xl bg-ink/95 p-3 shadow-xl ring-2 ring-gold" role="status" aria-label="Digging" data-digging={digLeft}>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 font-display text-lg font-extrabold">⛏ Digging by hand… {digLeft}s</p>
              <button
                type="button"
                onClick={() => {
                  setDigging(null);
                  setSay("You stop digging.");
                }}
                className="h-8 rounded-lg border border-line px-2 text-xs font-bold"
              >
                Stop
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${Math.round(((60 - digLeft) / 60) * 100)}%` }} />
            </div>
            {!me?.spade && (
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">A spade digs at once.</span>
                <button type="button" disabled={!!buying} onClick={() => void buy("spade")} className="h-8 shrink-0 rounded-lg bg-gold px-2 font-bold text-ink disabled:opacity-60">
                  Buy a spade · 80
                </button>
              </div>
            )}
          </div>
        )}
        {bagOpen && (
          <div className="pointer-events-auto flex max-h-[calc(100dvh-var(--house-head,8rem)-var(--house-foot,5rem)-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-ink/95 p-4 shadow-xl ring-1 ring-line" role="dialog" aria-label="Your bag">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 font-display text-lg font-extrabold">🎒 Your bag</p>
              <span className="text-sm font-extrabold text-gold">🪙 {me ? me.coins.toLocaleString() : "…"}</span>
              <button type="button" onClick={() => setBagOpen(false)} className="h-8 rounded-lg border border-line px-2 text-xs font-bold" aria-label="Close the bag">
                Close
              </button>
            </div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gold">Tools for this place</p>
            {TOOLS.map((t) => {
              const owned = !!me?.[t.id];
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-xl bg-ink-2 px-3 py-2 ring-1 ring-line" data-tool={t.id} data-owned={owned}>
                  <span className="text-2xl" aria-hidden="true">{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{t.name}</p>
                    <p className="text-xs text-paper/70">{t.does}</p>
                  </div>
                  {owned ? (
                    <span className="shrink-0 rounded-full bg-paper/10 px-2 py-1 text-xs font-bold">Yours ✓</span>
                  ) : (
                    <button type="button" disabled={!!buying} onClick={() => void buy(t.id)} className="h-9 shrink-0 rounded-lg bg-gold px-3 text-sm font-bold text-ink disabled:opacity-60">
                      {buying === t.id ? "…" : `Buy · ${t.price}`}
                    </button>
                  )}
                </div>
              );
            })}
            {bagNote && (
              <p role="status" className="rounded-lg bg-paper/10 px-2 py-1 text-center text-sm font-bold">
                {bagNote}
              </p>
            )}
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gold">Found here</p>
            <p className="text-sm">{view?.items.length ? view.items.map((it) => `${it.icon} ${it.name}`).join(" · ") : "Nothing from this place yet."}</p>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-gold">Relics and Wonders</p>
            <p className="text-sm">
              {carried === null
                ? "…"
                : [...carried.relics.map((r) => `${RELIC_ICON[r.relic] ?? "✨"} ${RELICS[r.relic]?.name ?? r.relic}${r.charges > 1 ? ` ×${r.charges}` : ""}`), ...carried.wonders.map((w) => `🪔 ${w.wonder.replace(/_/g, " ")}`)].join(" · ") || "None yet."}
            </p>
            <p className="text-xs text-paper/70">Relics and Wonders are used out on the map. Your vehicles wait outside: here, you walk.</p>
          </div>
        )}
        {gained && (
          <p className="rounded-2xl bg-gold px-4 py-3 text-center font-bold text-ink shadow-lg">
            {gained.icon} {gained.name}: into your bag
          </p>
        )}
      </div>
      {handheld && view && !roomPuzzle && !bagOpen && (
        <Joystick
          className="absolute right-4 z-10" // on the right, under the thumb, as on the map (owner, 7 Nov 2026)
          style={{ bottom: "calc(var(--house-foot, 5rem) + 0.75rem)" }}
          onMove={(x, y) => (joy.current = { x, y })}
          onEnd={() => (joy.current = { x: 0, y: 0 })}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col" data-house-foot>
        {action && !roomPuzzle && !dodge && !bagOpen && (
          <button
            type="button"
            disabled={busy}
            onClick={() => doActionRef.current()}
            className="pointer-events-auto mx-auto mb-3 flex h-14 items-center gap-2 rounded-2xl bg-gold px-6 font-display text-lg font-extrabold text-ink shadow-lg active:scale-95 disabled:opacity-60"
            data-action={action.kind}
          >
            {action.label}
            {handheld ? "" : <span className="rounded-md bg-ink/15 px-1.5 py-0.5 text-xs font-bold">Enter</span>}
          </button>
        )}
        {canDig && !action && (
          <button
            type="button"
            onClick={() => void startDig(standing)}
            className="pointer-events-auto mx-auto mb-3 flex h-14 items-center gap-2 rounded-2xl bg-gold px-6 font-display text-lg font-extrabold text-ink shadow-lg active:scale-95"
          >
            ⛏ Dig here
          </button>
        )}
        <p
          className="pointer-events-auto mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-2xl bg-ink/85 px-4 py-2.5 text-sm leading-relaxed backdrop-blur-sm"
          aria-live="polite"
          data-house-say
        >
          {say}
        </p>
      </div>
    </div>
  );
}
