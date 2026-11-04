"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createClient } from "@/lib/supabase/client";
import type { AvatarLook } from "@/lib/avatar";
import { animateAvatar, buildAvatar } from "@/game/models3d";
import type { HouseObjectView, HouseRoomView, HouseStyle, InnerRoomView } from "@/game/house3d";
import { buildKeyWorld, type KeyScene, type KeyWorld, type Point } from "@/game/keyworld";
import { daylight, sunAt } from "@/game/sun";
import { RELIC_ICON, RELICS, type RelicId } from "@/game/items";
import { PuzzleBoard } from "./puzzles/PuzzleTrial";
import { PUZZLE_NAMES } from "@/game/puzzles/names";
import type { Penalty } from "./PenaltyCard";
import { Joystick, useHandheld } from "./Joystick";

type Item = { id: string; name: string; icon: string };
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
/** A room of the treasure building being opened: its puzzle (from /api/house/room), and when its 60 seconds end. */
type RoomPuzzle = { n: number; kind: string; puzzle: unknown; ends: number };
const NEAR_M = 3; // the detector reads a place from the street this close to its way in
type Opened = {
  ok?: boolean;
  right?: boolean;
  reason?: string;
  outcome?: InnerRoomView["outcome"];
  coins?: number;
  balance?: number;
  chapter?: number;
  award?: unknown;
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
const ZOOM = { phone: 1, laptop: 1.1, min: 0.55, max: 2.6 };
const TURN = 2.6; // radians a second, turning with the keys or the joystick
const REFUSED: Record<string, string> = {
  away: "You've moved away from this place.",
  no_house: "There's nothing to search here.",
  not_live: "The hunt isn't on right now.",
  not_hunting: "You're not in this hunt.",
  dodge: "Answer the challenge first!",
  late: "⏳ Too slow: the lock has jammed. Try again in a moment.",
};

/** What a room held, said once it's open. */
const OUTCOME_SAID: Record<string, string> = {
  coins: "the coins are yours.",
  chapter: "the page of the story is on your scroll.",
  key: "the key.",
  decoy: "a fake chest. Nothing more here.",
  trap: "a trap, sprung. Nothing more here.",
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** What a locked find is called: the key's chest (room 1, at the right place), or a box in a house (rooms 2 to 5). */
const boxName = (n: number) => (n === 1 ? "The key's chest" : "The box");

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
}) {
  const [supabase] = useState(createClient);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<QuarterView | null>(null);
  const [say, setSay] = useState<string>("Walk about the place (the joystick, the arrow keys, or tap where to go). Go into the place you think it is: a wrong one bites. Out in the open, dig.");
  const [standing, setStanding] = useState(-1); // the place the hunter is in (-1: out in the town)
  const [near, setNear] = useState(-1); // the place the detector reads: the one stood in, or the nearest way in
  const [wide, setWide] = useState(false); // the whole town asked for
  // The joystick on phones and tablets (Joystick.tsx): where the thumb is, read by the walking every frame.
  const joy = useRef({ x: 0, y: 0 });
  const handheld = useHandheld();
  const wideRef = useRef(wide);
  useEffect(() => {
    wideRef.current = wide;
  }, [wide]);
  const [busy, setBusy] = useState(false);
  const [gained, setGained] = useState<Item | null>(null);
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
  const [me, setMe] = useState<Me | null>(null);
  const torchRef = useRef(false);
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
    void supabase.rpc("house_view", { p_hunt: huntId }).then(({ data }) => {
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
    if (!uid || worldKey == null) return;
    const others = othersRef.current, looks = looksRef.current;
    const ch = supabase.channel(`keyworld:${huntId}:${worldKey}`, { config: { presence: { key: uid }, broadcast: { self: false } } });
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
  }, [uid, worldKey, huntId, supabase, look]);

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
      const { data } = await supabase.rpc("house_step", { p_hunt: huntId, p_room: i >= 0 ? v.rooms[i].id : null });
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
        else setSay(`🏠 Inside ${v.rooms[i].name}…`);
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
    // The street just outside each place's way in (tests walk there to read the detector from the street)
    el.parentElement?.setAttribute("data-fronts", JSON.stringify(Object.fromEntries(kw.places.map((p) => [p.id, [p.front.x, p.front.z]]))));
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
    let stepping = false;
    const asked = new Set<number>(); // locked doors already tried on this approach
    const armed = [true, true, true, true, true, true]; // room doors, ready to open as the hunter walks up
    const ghosts = new Map<string, ReturnType<typeof buildAvatar>>(); // the other hunters drawn
    let lastSent = 0;
    let lastCount = 0;
    let sent = { x: 0, z: 0, in: false };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // a slow phone still walks at full speed (a step stays thinner than a wall)
      last = now;
      for (let j = fx.length - 1; j >= 0; j--) if (fx[j](now)) fx.splice(j, 1);
      let moved = 0;
      // Steering (the joystick or the keys): it takes over from a walk to a tapped spot.
      const stick = joy.current;
      const steering = keys.size > 0 || Math.hypot(stick.x, stick.y) > 0.15;
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
          ahead = Math.abs(stick.y) > 0.15 ? -stick.y : 0;
          turn = Math.abs(stick.x) > 0.15 ? -stick.x : 0;
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
      // A locked door, walked up to: try it (with the thing it needs, if carried)
      if (v && !stepping && !busyRef.current) {
        kw.places.forEach((p, i) => {
          const d = dist(at, p.front);
          if (d > 3) asked.delete(i);
          else if (d < 1.6 && v.rooms[i]?.locked && !asked.has(i)) {
            asked.add(i);
            stepping = true;
            void stepRef.current(i).finally(() => (stepping = false));
          }
        });
      }
      // A locked box in a house (or the key's chest), walked up to: its puzzle opens (owner, 4 Nov 2026: "do not keep
      // all the item in one house")
      const spots = kw.boxSpots();
      if (now - lastShown < 1) el.parentElement?.setAttribute("data-boxes", JSON.stringify(spots)); // tests read it
      for (const [key, spot] of Object.entries(spots)) {
        const n = Number(key);
        const d = dist(at, spot);
        if (d > 1.6) armed[n] = true;
        else if (d < 0.7 && armed[n] && !v?.inner?.[n - 1]?.open && !roomPuzzleRef.current && !busyRef.current) {
          armed[n] = false;
          void openRoomRef.current(n);
        }
      }
      // Into a small house: what's there (a box, or nothing at all)
      const home = kw.homeAt(at);
      if (home !== lastHome) {
        lastHome = home;
        if (home >= 0) setSay(kw.homeBox(home) ? "📦 Inside a house: a locked box at the back. Walk up to it to try its lock." : "🏚 Inside a house: nothing here.");
        el.parentElement?.setAttribute("data-home", String(home)); // tests read it
      }
      // The detector, from the street too (owner, 3 Nov 2026: "the metal detector helps in locating where treasures are buried")
      const nearNow = here >= 0 ? here : kw.places.findIndex((p) => dist(at, p.front) < NEAR_M);
      if (nearNow !== lastNear) {
        lastNear = nearNow;
        setNear(nearNow);
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
  }, [built, look]);

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
        return;
      }
      if (tap === "object" && id) {
        const spot = kw.objectSpot(id);
        if (spot) await s.walkTo(kw.route(s.at(), spot));
        if (kw.placeAt(s.at()) !== i) return setSay("You can't reach that from here.");
        setBusy(true);
        try {
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
      const res = await fetch("/api/house/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hunt: huntId, room: n }) });
      const r = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; kind?: string; puzzle?: unknown; open?: boolean; seconds?: number; secondsLeft?: number } | null;
      if (r?.reason === "jammed") return setSay(`⏳ ${boxName(n)}'s lock is jammed: try again in ${Math.max(1, Math.ceil(r.seconds ?? 30))} s.`);
      if (!r?.ok || !r.kind) return setSay(REFUSED[r?.reason ?? ""] ?? "The door won't budge right now.");
      setRoomNote(null);
      const left = Math.max(1, Math.min(60, r.secondsLeft ?? 60));
      setRoomLeft(left);
      setRoomPuzzle({ n, kind: r.kind, puzzle: r.puzzle, ends: Date.now() + left * 1000 });
      setSay(`🔒 ${boxName(n)} is locked by a puzzle: solve it in 60 seconds to open it.`);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

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
    try {
      const res = await fetch("/api/house/room/solve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hunt: huntId, room: rp.n, answer }) });
      const r = (await res.json().catch(() => null)) as Opened | null;
      if (r?.reason === "late") {
        setRoomPuzzle(null);
        return setSay(`⏳ Too slow: ${boxName(rp.n)}'s lock jams for 30 s. Then it has a new puzzle.`);
      }
      if (!r?.ok) return setRoomNote(REFUSED[r?.reason ?? ""] ?? "Something went wrong. Try again.");
      if (!r.right) {
        setRoomShake((k) => k + 1);
        return setRoomNote("Not quite: the lock doesn't turn. Look again.");
      }
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

  // A room's 60 seconds (owner, 3 Nov 2026: "each puzzle time should be 60"): out of time, the lock jams for 30 s.
  useEffect(() => {
    if (!roomPuzzle) return;
    const n = roomPuzzle.n;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((roomPuzzle.ends - Date.now()) / 1000));
      setRoomLeft(left);
      if (left > 0) return;
      window.clearInterval(t);
      setRoomPuzzle((p) => (p?.n === n ? null : p));
      setSay(`⏳ Too slow: ${boxName(n)}'s lock jams for 30 s. Then it has a new puzzle.`);
    }, 250);
    return () => window.clearInterval(t);
  }, [roomPuzzle]);

  // The detector: once at each place, how hot it is (only with one; the server never says which is right). It reads
  // the place stood in, or from the street the one whose way in is close.
  useEffect(() => {
    const v = viewRef.current;
    const room = near >= 0 ? v?.rooms[near]?.id : null;
    if (!room || heatAsked.current.has(room)) return;
    heatAsked.current.add(room);
    void supabase.rpc("house_detect", { p_hunt: huntId, p_room: room }).then(({ data }) => {
      const d = data as { ok: boolean; reason?: string; heat?: string } | null;
      setHeat((h) => ({ ...h, [room]: d?.ok && d.heat ? d.heat : d?.reason === "no_detector" ? "none" : "" }));
    });
  }, [near, huntId, supabase, heard]);
  /** Searching a place (a building, as the hunter walks in; open ground, with ⛏ Dig here): the server decides (a
   * trap's challenge, nothing, the treasure building's rooms, or a buried chest). */
  async function search(i: number) {
    const s = scene.current;
    const v = viewRef.current;
    if (!s || !v || i < 0) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("house_enter", { p_hunt: huntId, p_room: v.rooms[i].id });
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
        setSay(open ? `⚠️ Your spade hits something that clicks… a trap! The key isn't here.` : `⚠️ Something clicks under your foot… a trap! The key isn't here.`);
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
        setSay(next.rooms[found].outdoor ? "⛏ Your spade hits wood: the key's chest! Walk up to it: its lock is a 60-second puzzle." : "🔍 This is it! The key's chest is here, locked by a 60-second puzzle. Walk up to it.");
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
      const { data } = await supabase.rpc("house_dodge", { p_hunt: huntId, p_choice: choice });
      const r = data as { ok: boolean; dodged?: boolean; penalty?: Penalty & { balance: number | null; energy: number | null } } | null;
      const name = viewRef.current?.rooms[d.room]?.name ?? "this place";
      if (r?.dodged) {
        setSay(`💨 You dodged it! You jump clear of ${name}. It's a trap, though: not there.`);
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
  const readingOf = read && standing < 0 ? read.name : "";
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 bg-[#1B2230] text-paper" role="dialog" aria-modal="true" aria-label="The key's place" data-busy={busy} data-inside={on?.id ?? ""} data-me={uid ?? ""}>
      {/* The world fills the screen; the bars float over it. */}
      <div ref={host} className="absolute inset-0 touch-none" data-house />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#1B2230]/85 via-[#1B2230]/50 to-transparent pb-3" data-house-head>
        <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Key {view?.key ?? ""}</p>
            <h2 className="truncate font-display text-xl font-extrabold">{view?.title ?? "The key's place"}</h2>
          </div>
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
            <div key={roomShake} className={`mx-auto w-full max-w-[min(100%,24rem)] ${roomShake ? "loota-shake" : ""} ${me?.torch ? "" : "brightness-[0.45] contrast-[0.8]"}`} data-dark={me?.torch ? "false" : "true"}>
              <PuzzleBoard kind={roomPuzzle.kind} puzzle={roomPuzzle.puzzle} disabled={busy} onDone={(a) => void solveRoom(a)} />
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
          className="absolute left-4 z-10"
          style={{ bottom: "calc(var(--house-foot, 5rem) + 0.75rem)" }}
          onMove={(x, y) => (joy.current = { x, y })}
          onEnd={() => (joy.current = { x: 0, y: 0 })}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col" data-house-foot>
        {canDig && (
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
