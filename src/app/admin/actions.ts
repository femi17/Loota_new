"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlayer } from "@/lib/player";

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
  });
  if (error) back(`Couldn't add the key: ${error.message}`, true);
  revalidatePath("/admin");
  back(
    spot.movedM === null
      ? `Key ${(count ?? 0) + 1} added. The road check is unavailable right now, so the spot is exactly as pasted: make sure it's on or beside a road (hunters must get within 40 m).`
      : `Key ${(count ?? 0) + 1} added. Its spot was moved ${spot.movedM} m onto the nearest road.`,
  );
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
