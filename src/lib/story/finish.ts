import { createAdminClient } from "@/lib/supabase/admin";
import { nearestRoad } from "@/lib/nearest-road";
import { blueprintOf, radiusOf, usedBy, type Used, type Work } from "./engine";

/** How far from a key's place the hot-and-cold search starts. */
const AREA_M = 1500;

/** Every story already written (no new story reuses their places, decoys, characters or titles). */
export async function storyRegistry(): Promise<Used[]> {
  const { data } = await createAdminClient().from("story_registry").select("title, genre, theme, locks, channels, places, decoys, characters").order("id");
  return (data ?? []) as Used[];
}

/**
 * A finished story becomes its hunt: the hunt takes the story's title and logline; each key is set at its real place
 * (moved onto the nearest road a hunter on foot can reach), asked by its question; every picture prompt becomes a slot
 * to upload a picture to; and the story goes into the registry. Returns notes for the owner (keys that couldn't be
 * placed).
 */
export async function finishStoryHunt(hunt: string, work: Work): Promise<string[]> {
  const db = createAdminClient();
  const b = blueprintOf(work);
  const notes: string[] = [];
  await db.from("hunt_keys").delete().eq("hunt_id", hunt); // a hunt finished twice starts its keys afresh
  let n = 0;
  for (const key of b.keys) {
    const found = work.map[key.n]?.found;
    if (!found) {
      notes.push(`Key ${key.n} (${key.answer.name}) isn't on the map: add it by hand.`);
      continue;
    }
    // The chest on the nearest road or path, if that's still at the place itself (an exact key: owner, 31 Oct 2026).
    const radius = radiusOf(key.answer);
    const road = await nearestRoad(found);
    const spot = road && (road.movedM ?? 0) <= radius ? road : found;
    n += 1;
    const { error } = await db.from("hunt_keys").insert({
      hunt_id: hunt,
      n,
      riddle: key.question,
      category: "general",
      trial_kind: "puzzle",
      relay: false,
      area_lng: found.lng,
      area_lat: found.lat,
      area_radius_m: AREA_M,
      exact_m: radius,
      approach_clue: null,
      spot_lng: spot.lng,
      spot_lat: spot.lat,
      scene: "circle",
    });
    if (error) notes.push(`Key ${key.n}: ${error.message}`);
  }
  // Picture slots: one per prompt (an import done again keeps pictures already uploaded to slots that are still there).
  const pictures = (work.production?.pictures ?? []).map((p, i) => ({ hunt_id: hunt, n: i + 1, chapter: p.chapter, prompt: p.prompt }));
  if (pictures.length) await db.from("story_pictures").upsert(pictures, { onConflict: "hunt_id,n" });
  await db.from("story_pictures").delete().eq("hunt_id", hunt).gt("n", pictures.length);
  // The registry: this story once (an import done again replaces it).
  await db.from("story_registry").delete().eq("hunt_id", hunt);
  await db.from("story_registry").insert({ ...usedBy(work), hunt_id: hunt });
  await db.from("hunts").update({ title: b.title.slice(0, 80), description: b.logline.slice(0, 1000), story: work, story_status: "ready" }).eq("id", hunt);
  return notes;
}
