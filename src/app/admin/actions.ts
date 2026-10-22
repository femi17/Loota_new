"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlayer } from "@/lib/player";
import { KEY_SCENE_INFO, isKeyScene, type KeyScene } from "@/game/keyScenes";

/** Only the owner may change hunts; everything below uses the secret key after this check. */
async function owner() {
  const player = await getPlayer();
  if (!player?.isAdmin) redirect("/lobby");
  return player;
}

const back = (message: string, error = false): never => redirect(`/admin?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const whole = (form: FormData, name: string) => Number.parseInt(text(form, name), 10);
/** A date and time typed in Lagos time (the datetime-local field has no time zone). */
const lagosTime = (value: string) => new Date(`${value}:00+01:00`);
const UUID = /^[0-9a-f-]{36}$/i;

/** "6.4541, 3.3958" (as Google Maps copies it: latitude first) → { lng, lat }. */
function coordinates(value: string) {
  const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lng, lat };
}

/** The nearest point a hunter on foot can reach, so a key is never inside a building or on water. */
async function nearestRoad(point: { lng: number; lat: number }) {
  try {
    const res = await fetch(`https://routing.openstreetmap.de/routed-foot/nearest/v1/foot/${point.lng},${point.lat}?number=1`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { waypoints?: { location: [number, number]; distance: number }[] };
    const w = data.waypoints?.[0];
    if (!w) return null;
    return { lng: w.location[0], lat: w.location[1], movedM: Math.round(w.distance) };
  } catch {
    return null;
  }
}

const metresBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.hypot((a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110574);

/**
 * The scene a key's place should be (src/game/keyScenes.ts), from what's within 150 m of its spot: one of our
 * landmarks (a monument's plaza), a motor park, or from OpenStreetMap a market, park, beach, school, stadium or palace
 * (the nearest wins); the stone circle when there's nothing (or OpenStreetMap doesn't answer in time).
 */
async function guessScene(spot: { lng: number; lat: number }): Promise<{ scene: KeyScene; why: string }> {
  const db = createAdminClient();
  const box = { w: spot.lng - 0.002, e: spot.lng + 0.002, s: spot.lat - 0.002, n: spot.lat + 0.002 };
  const { data: landmarks } = await db.from("landmarks").select("name, lng, lat").gte("lng", box.w).lte("lng", box.e).gte("lat", box.s).lte("lat", box.n);
  const lm = (landmarks ?? []).find((l) => metresBetween(l, spot) <= 150);
  if (lm) return { scene: "landmark", why: `by ${lm.name}` };
  const { data: parks } = await db.from("transit_stops").select("name, lng, lat").eq("kind", "bus").eq("park", true).gte("lng", box.w).lte("lng", box.e).gte("lat", box.s).lte("lat", box.n);
  const park = (parks ?? []).find((p) => metresBetween(p, spot) <= 150);
  if (park) return { scene: "motor_park", why: `by ${park.name}` };
  // Parks and gardens are in our own places (the chill spots): no need to ask OpenStreetMap.
  const { data: rest } = await db.from("places").select("name, lng, lat").eq("kind", "rest").gte("lng", box.w).lte("lng", box.e).gte("lat", box.s).lte("lat", box.n);
  const garden = (rest ?? []).find((p) => metresBetween(p, spot) <= 150);
  if (garden) return { scene: "park", why: `by ${garden.name}` };
  try {
    const q = `[out:json][timeout:25];(nwr(around:150,${spot.lat},${spot.lng})[amenity~"^(marketplace|school|college|university)$"];nwr(around:150,${spot.lat},${spot.lng})[leisure~"^(park|garden|stadium|pitch)$"];nwr(around:150,${spot.lat},${spot.lng})[natural=beach];nwr(around:150,${spot.lat},${spot.lng})[historic=palace];nwr(around:150,${spot.lat},${spot.lng})[building=palace];);out center tags;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "loota-game-admin/1.0" },
      body: new URLSearchParams({ data: q }),
      signal: AbortSignal.timeout(25000), // the public server can be slow
    });
    const data = (await res.json()) as { elements?: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
    let best: { scene: KeyScene; m: number; name: string } | null = null;
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const at = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null);
      if (!at) continue;
      const scene: KeyScene | null =
        t.amenity === "marketplace" ? "market"
        : ["school", "college", "university"].includes(t.amenity ?? "") ? "school"
        : t.leisure === "stadium" || t.leisure === "pitch" ? "stadium"
        : t.leisure === "park" || t.leisure === "garden" ? "park"
        : t.natural === "beach" ? "beach"
        : t.historic === "palace" || t.building === "palace" ? "palace"
        : null;
      if (!scene) continue;
      const m = metresBetween({ lng: at.lon, lat: at.lat }, spot);
      if (!best || m < best.m) best = { scene, m, name: t.name ?? KEY_SCENE_INFO[scene].label.toLowerCase() };
    }
    if (best) return { scene: best.scene, why: `by ${best.name}` };
    return { scene: "circle", why: "nothing particular within 150 m" };
  } catch {
    return { scene: "circle", why: "OpenStreetMap didn't answer in time: choose a scene by hand if it should be one" };
  }
}

export async function createHunt(form: FormData) {
  const player = await owner();
  const startsAt = lagosTime(text(form, "starts"));
  const endsAt = lagosTime(text(form, "ends"));
  const hunt = {
    title: text(form, "title"),
    prize: text(form, "prize"),
    description: text(form, "description"),
    winners: whole(form, "winners"),
    questions_per_trial: whole(form, "questions"),
    seconds_per_question: whole(form, "seconds"),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    created_by: player.id,
  };
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) back("Enter a start and end time.", true);
  if (endsAt <= startsAt) back("The hunt must end after it starts.", true);
  const { error } = await createAdminClient().from("hunts").insert(hunt);
  if (error) back(`Couldn't create the hunt: ${error.message}`, true);
  revalidatePath("/admin");
  back("Hunt created as a draft. Add its keys, then publish it.");
}

export async function addKey(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  if (!UUID.test(hunt)) back("Unknown hunt.", true);
  const area = coordinates(text(form, "area"));
  const spotTyped = coordinates(text(form, "spot"));
  if (!area || !spotTyped) back("Paste coordinates like 6.4541, 3.3958 (latitude, longitude).", true);
  // The road service is a free public one and is sometimes down: then keep the spot as typed.
  const spot = (await nearestRoad(spotTyped!)) ?? { ...spotTyped!, movedM: null };

  // The key's place as a scene: chosen, or guessed from what's there.
  const chosen = text(form, "scene");
  const picked = isKeyScene(chosen) ? { scene: chosen, why: "chosen" } : await guessScene(spot!);

  const db = createAdminClient();
  const { count } = await db.from("hunt_keys").select("n", { count: "exact", head: true }).eq("hunt_id", hunt);
  const { error } = await db.from("hunt_keys").insert({
    hunt_id: hunt,
    n: (count ?? 0) + 1,
    riddle: text(form, "riddle"),
    category: text(form, "category"),
    area_lng: area!.lng,
    area_lat: area!.lat,
    area_radius_m: whole(form, "radius"),
    approach_clue: text(form, "clue") || null,
    spot_lng: spot!.lng,
    spot_lat: spot!.lat,
    scene: picked.scene,
  });
  if (error) back(`Couldn't add the key: ${error.message}`, true);
  revalidatePath("/admin");
  const scene = ` Its place: ${KEY_SCENE_INFO[picked.scene].label} (${picked.why}).`;
  back(
    spot.movedM === null
      ? `Key ${(count ?? 0) + 1} added. The road check is unavailable right now, so the spot is exactly as pasted: make sure it's on or beside a road (hunters must get within 40 m).${scene}`
      : `Key ${(count ?? 0) + 1} added. Its spot was moved ${spot.movedM} m onto the nearest road.${scene}`,
  );
}

/** Change the scene of a key's place (it only changes how the place looks, so even in a published hunt). */
export async function setKeyScene(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  const n = whole(form, "n");
  const scene = text(form, "scene");
  if (!UUID.test(hunt) || !Number.isInteger(n) || !isKeyScene(scene)) back("Unknown key or scene.", true);
  const { error } = await createAdminClient().from("hunt_keys").update({ scene }).eq("hunt_id", hunt).eq("n", n);
  if (error) back(`Couldn't change the scene: ${error.message}`, true);
  revalidatePath("/admin");
  back(`Key ${n}'s place is now: ${KEY_SCENE_INFO[scene as KeyScene].label}.`);
}

export async function removeLastKey(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  if (!UUID.test(hunt)) back("Unknown hunt.", true);
  const db = createAdminClient();
  const { data: h } = await db.from("hunts").select("published").eq("id", hunt).single();
  if (h?.published) back("Unpublish the hunt before changing its keys.", true);
  const { data: last } = await db.from("hunt_keys").select("n").eq("hunt_id", hunt).order("n", { ascending: false }).limit(1).maybeSingle();
  if (last) await db.from("hunt_keys").delete().eq("hunt_id", hunt).eq("n", last.n);
  revalidatePath("/admin");
  back(last ? `Key ${last.n} removed.` : "That hunt has no keys.");
}

export async function setPublished(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  const publish = text(form, "publish") === "true";
  if (!UUID.test(hunt)) back("Unknown hunt.", true);
  const db = createAdminClient();
  if (publish) {
    const { count } = await db.from("hunt_keys").select("n", { count: "exact", head: true }).eq("hunt_id", hunt);
    if (!count) back("Add at least one key before publishing.", true);
  }
  const { error } = await db.from("hunts").update({ published: publish }).eq("id", hunt);
  if (error) back(`Couldn't update the hunt: ${error.message}`, true);
  revalidatePath("/admin");
  back(publish ? "Published: hunters can see and join it in the lobby." : "Unpublished: hidden from hunters.");
}

export async function deleteDraft(form: FormData) {
  await owner();
  const hunt = text(form, "hunt");
  if (!UUID.test(hunt)) back("Unknown hunt.", true);
  const db = createAdminClient();
  const { count } = await db.from("hunt_players").select("user_id", { count: "exact", head: true }).eq("hunt_id", hunt);
  if (count) back("Hunters have joined this hunt, so it can't be deleted. Unpublish it instead.", true);
  await db.from("hunts").delete().eq("id", hunt).eq("published", false);
  revalidatePath("/admin");
  back("Draft deleted.");
}

/** Summon the Djinn now (design doc 7.6): opens a Wager if none is on. For testing until the weekly surprise is switched on. */
export async function summonDjinn() {
  await owner();
  const { data, error } = await createAdminClient().rpc("djinn_open_wager");
  if (error) back(`Couldn't summon the Djinn: ${error.message}`, true);
  back(data ? "The Djinn has woken. Every player's lamp is smoking." : "A Wager is already on.");
}

const RiddleDrafts = z.object({
  drafts: z.array(z.object({ riddle: z.string(), clue: z.string(), why: z.string() })),
});

/**
 * Riddles for a key, drafted by Claude (owner, 22 Oct 2026): the owner names the place and picks one (or edits it).
 * Claude Sonnet 5.5, as a riddle must point at the right place (about a cent a draft).
 */
export async function draftRiddles(
  place: string,
  level: "easy" | "medium" | "hard",
): Promise<{ ok: true; drafts: { riddle: string; clue: string; why: string }[] } | { ok: false; message: string }> {
  await owner();
  const where = place.trim().slice(0, 160);
  if (where.length < 3) return { ok: false, message: "Type the place first, like “National Theatre, Iganmu, Lagos”." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Claude isn't set up: add ANTHROPIC_API_KEY to the server's settings." };
  try {
    const response = await new Anthropic().beta.messages.parse({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a declined request is retried on Anthropic's recommended model
      output_config: { effort: "medium", format: betaZodOutputFormat(RiddleDrafts) },
      system: `You write riddles for Loota, a real-map treasure hunt played in Nigeria. A riddle points hunters to a real
place; they work it out, travel there on the map and search for the key. Write riddles that:
- never name the place, its district or its street, or use the words of its name (the city or state is fine);
- rest on true, distinctive things about it (its shape, nickname, history, what happens there, what's near it) that
  you are certain of: a riddle that points to the wrong place ruins the hunt;
- a sharp local could solve: one or two short sentences, at most 160 characters, vivid and playful;
- match the difficulty: easy = a famous feature or nickname; medium = needs one real fact; hard = wordplay or two facts
  together.
Example of the style: "A general's cap rests by the water: the house of drama built for FESTAC '77." (the National
Theatre, Lagos).
For each riddle also write a Final Approach clue (at most 120 characters), shown only to hunters already in the area,
that leads to the exact spot (an entrance, a statue, a gate), and "why": one line on which facts the riddle uses, so the
organiser can check it.`,
      messages: [{ role: "user", content: `Write 4 different ${level} riddles for this place: ${where}` }],
    });
    if (response.stop_reason === "refusal") return { ok: false, message: "Claude declined to draft riddles for that. Try describing the place differently." };
    const drafts = response.parsed_output?.drafts.filter((d) => d.riddle.trim().length >= 5).slice(0, 4) ?? [];
    if (!drafts.length) return { ok: false, message: "Claude didn't come up with riddles that time. Try again." };
    return { ok: true, drafts };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: "Claude didn't accept the API key: check ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, message: "Claude is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.APIError) return { ok: false, message: `Claude couldn't draft right now (error ${e.status}). Try again.` };
    return { ok: false, message: "Couldn't reach Claude. Check the connection and try again." };
  }
}
