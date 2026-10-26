// The Djinn's Wonders at work (design doc 7.7): every Wonder used in a throwaway live hunt by test players,
// what it does to the others, the Djinn's Coin saving its holder, and the news everyone hears.
// The hunt, its news and the test players are deleted afterwards.
//   node scripts/tests/wonder-powers-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
let huntId = null;
let entry = null;
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const metres = (a, b) => {
  const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

// Lagos: hunters around Yaba; homes elsewhere in the city.
const yaba = { lng: 3.3787, lat: 6.5186 };
const near = (m) => ({ lng: yaba.lng + m / 110000, lat: yaba.lat });
const KEYS = [
  { n: 1, spot: { lng: 3.3790, lat: 6.5190 } },
  { n: 2, spot: { lng: 3.3900, lat: 6.5300 } },
  { n: 3, spot: { lng: 3.4000, lat: 6.5400 } },
];

async function player(tag, home, at) {
  const email = `wonder-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id; ids.push(id);
  await admin.from("profiles").update({ home_lng: home.lng, home_lat: home.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: at.lng, lat: at.lat, mode: "walk", updated_at: ago(60) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args) => {
    const { data: d, error: e } = await c.rpc(fn, args);
    if (e) throw new Error(`${fn}: ${e.message}`);
    return d;
  };
  const { data: prof } = await admin.from("profiles").select("username").eq("id", id).single();
  return { id, c, rpc, home, name: prof.username };
}
const posOf = async (p) => (await admin.from("player_positions").select("lng, lat").eq("user_id", p.id).single()).data;
const keysOf = async (p) => (await admin.from("hunt_players").select("keys_held").eq("hunt_id", huntId).eq("user_id", p.id).single()).data.keys_held;
const give = async (p, wonder) => (await admin.from("player_wonders").insert({ user_id: p.id, wonder }).select("id").single()).data.id;
const usedAt = async (wid) => (await admin.from("player_wonders").select("used_at").eq("id", wid).single()).data.used_at;
const setPos = (p, at) => admin.from("player_positions").update({ lng: at.lng, lat: at.lat, updated_at: ago(60) }).eq("user_id", p.id);

try {
  const A = await player("a", { lng: 3.35, lat: 6.60 }, yaba); // the holder
  const B = await player("b", { lng: 3.30, lat: 6.45 }, near(5000)); // far from A, with a Coin
  const C = await player("c", { lng: 3.42, lat: 6.43 }, near(400)); // close to A
  const D = await player("d", { lng: 3.45, lat: 6.47 }, near(800)); // will wear the Cloak
  console.log("players:", [A, B, C, D].map((p) => p.name).join(", "));

  // ---- Outside a hunt
  const hg = await give(A, "hourglass_of_ages");
  check("outside a hunt, a hunt Wonder sleeps", (await A.rpc("use_wonder", { p_wonder: hg }))?.reason === "no_hunt");
  check("…and isn't used up", !(await usedAt(hg)));
  const coinA = await give(A, "djinn_coin");
  check("the Djinn's Coin can't be used: it works by itself", (await A.rpc("use_wonder", { p_wonder: coinA }))?.reason === "passive");
  await admin.from("player_wonders").update({ used_at: new Date().toISOString() }).eq("id", coinA); // A holds no Coin from here

  // ---- A throwaway live hunt
  const { data: hunt, error: huntErr } = await admin
    .from("hunts")
    .insert({ title: "Wonder test (automated)", prize: "none", winners: 3, starts_at: ago(3600), ends_at: new Date(Date.now() + 2 * 3600_000).toISOString(), published: true, all_day: true, questions_per_trial: 2, seconds_per_question: 15 })
    .select("id")
    .single();
  if (huntErr) throw huntErr;
  huntId = hunt.id;
  const { error: keysErr } = await admin.from("hunt_keys").insert(KEYS.map((k) => ({ hunt_id: huntId, n: k.n, riddle: `The test riddle ${k.n}`, category: "general", area_lng: k.spot.lng, area_lat: k.spot.lat, area_radius_m: 500, spot_lng: k.spot.lng, spot_lat: k.spot.lat })));
  if (keysErr) throw keysErr;
  for (const p of [A, B, C, D]) await p.rpc("join_hunt", { p_hunt: huntId });

  // ---- Master Key: only at the next key's spot; not used up when refused
  const mk = await give(A, "master_key");
  await setPos(A, near(300));
  check("Master Key away from the key: refused", (await A.rpc("use_wonder", { p_wonder: mk }))?.reason === "not_at_key");
  check("…and kept", !(await usedAt(mk)));
  await setPos(A, KEYS[0].spot);
  const mkUse = await A.rpc("use_wonder", { p_wonder: mk });
  check("Master Key at the spot: Key 1 without a trial", mkUse?.ok && mkUse.keysHeld === 1 && (await keysOf(A)) === 1, JSON.stringify(mkUse));
  await setPos(A, yaba);

  // ---- Thief's Hand: keys from hunters within 1 km
  await admin.from("hunt_players").update({ keys_held: 1 }).eq("hunt_id", huntId).in("user_id", [B.id, C.id]);
  const th = await give(A, "thiefs_hand");
  const thUse = await A.rpc("use_wonder", { p_wonder: th });
  check("Thief's Hand takes C's key (400 m away), not B's (5 km)", thUse?.ok && (await keysOf(C)) === 0 && (await keysOf(B)) === 1 && (await keysOf(A)) === 2, JSON.stringify(thUse));

  // ---- Hourglass: everyone else frozen
  const hgUse = await A.rpc("use_wonder", { p_wonder: hg });
  check("Hourglass turned", hgUse?.ok && hgUse.affected === 3);
  await admin.from("player_positions").update({ updated_at: ago(10) }).eq("user_id", B.id);
  const bMove = await B.rpc("save_position", { p_lng: near(5050).lng, p_lat: near(5050).lat, p_mode: "walk" });
  check("a frozen hunter can't move", bMove?.ok === false && bMove.reason === "frozen" && !!bMove.until, JSON.stringify(bMove));
  await admin.from("player_positions").update({ updated_at: ago(10) }).eq("user_id", A.id);
  const aMove = await A.rpc("save_position", { p_lng: near(30).lng, p_lat: near(30).lat, p_mode: "walk" });
  check("the holder still moves", aMove?.ok === true, JSON.stringify(aMove));
  const bNews = await B.rpc("wonder_news", { p_since: 0 });
  check("the frozen hunter's news says frozen, with the Hourglass's banner", !!bNews.frozenUntil && bNews.events.some((e) => e.wonder === "hourglass_of_ages" && e.hitMe));
  // Thaw them for the rest of the test.
  await admin.from("wonder_events").update({ ends_at: ago(1) }).eq("wonder", "hourglass_of_ages").eq("hunt_id", huntId);

  // ---- Eye of the Djinn
  const eye = await give(A, "eye_of_the_djinn");
  await A.rpc("use_wonder", { p_wonder: eye });
  const view = await A.rpc("eye_view");
  check("the Eye sees the 3 other hunters, and the key area each chases", view?.length === 3 && view.every((h) => h.chasing && h.chasing.radiusM === 500), JSON.stringify(view?.map((h) => [h.name, h.keysHeld, h.chasing?.key])));
  check("…and another hunter has no Eye", (await B.rpc("eye_view")) === null);

  // ---- Phantom Cloak (D), then the Orb of Oblivion: B's Coin saves B; C forgets; the cloaked D is untouched
  const cloak = await give(D, "phantom_cloak");
  await D.rpc("use_wonder", { p_wonder: cloak });
  check("the Cloak is on", !!(await D.rpc("eye_view")) === false && !!(await D.rpc("wonder_news", { p_since: 0 })).cloakUntil);
  check("the Eye no longer sees the cloaked hunter", (await A.rpc("eye_view")).length === 2);
  await admin.from("hunt_players").update({ keys_held: 1 }).eq("hunt_id", huntId).in("user_id", [C.id, D.id]);
  const coinB = await give(B, "djinn_coin");
  const ob = await give(A, "orb_of_oblivion");
  const obUse = await A.rpc("use_wonder", { p_wonder: ob });
  check("Oblivion: C forgets, B is spared by the Coin, cloaked D untouched, A keeps",
    obUse?.ok && (await keysOf(C)) === 0 && (await keysOf(B)) === 1 && (await keysOf(D)) === 1 && (await keysOf(A)) === 2 && obUse.spared === 1,
    JSON.stringify(obUse));
  check("…and B's Coin is spent", !!(await usedAt(coinB)));
  const bNews2 = await B.rpc("wonder_news", { p_since: bNews.latest });
  check("B hears of it, saved", bNews2.events.some((e) => e.wonder === "orb_of_oblivion" && e.savedMe && !e.hitMe));
  const cNews = await C.rpc("wonder_news", { p_since: 0 });
  check("C hears of it, hit", cNews.events.some((e) => e.wonder === "orb_of_oblivion" && e.hitMe));

  // ---- Djinn's Bargain: swap places with the leader (B, 1 key; D is cloaked)
  const aBefore = await posOf(A), bBefore = await posOf(B);
  const bg = await give(A, "djinns_bargain");
  const bgUse = await A.rpc("use_wonder", { p_wonder: bg });
  const aAfter = await posOf(A), bAfter = await posOf(B);
  check("Bargain: A and the leader B swap places", bgUse?.ok && metres(aAfter, bBefore) < 1 && metres(bAfter, aBefore) < 1, JSON.stringify(bgUse));

  // ---- Sandstorm Crown: everyone within 400 km of the holder, but the holder
  const ss = await give(A, "sandstorm_crown");
  await A.rpc("use_wonder", { p_wonder: ss });
  check("Sandstorm: C is in it", !!(await C.rpc("wonder_news", { p_since: 0 })).sandstorm);
  check("…the holder isn't", !(await A.rpc("wonder_news", { p_since: 0 })).sandstorm);

  // ---- Mirror of Many
  const mr = await give(A, "mirror_of_many");
  await A.rpc("use_wonder", { p_wonder: mr });
  check("Mirror: on for the hunt", !!(await A.rpc("wonder_news", { p_since: 0 })).mirrorUntil);

  // ---- Orb of Return: everyone home (A too), keys stay; the cloaked D stays put
  const dBefore = await posOf(D);
  const rt = await give(A, "orb_of_return");
  await A.rpc("use_wonder", { p_wonder: rt });
  const homeOk = async (p) => metres(await posOf(p), p.home) < 1;
  check("Return: A, B and C are home", (await homeOk(A)) && (await homeOk(B)) && (await homeOk(C)));
  check("…the cloaked D isn't moved", metres(await posOf(D), dBefore) < 1);
  check("…and keys stay", (await keysOf(A)) === 2 && (await keysOf(B)) === 1);

  // ---- Cataclysm: everyone (the cloaked too, the holder too) loses every key and goes home
  await setPos(A, yaba); await setPos(B, yaba); await setPos(D, near(800));
  const cat = await give(A, "cataclysm_orb");
  const catUse = await A.rpc("use_wonder", { p_wonder: cat });
  const allKeys = await Promise.all([A, B, C, D].map(keysOf));
  check("Cataclysm: all 4 hit, no keys left anywhere", catUse?.ok && catUse.affected === 4 && allKeys.every((k) => k === 0), JSON.stringify(allKeys));
  check("…everyone (the cloaked D too) is home", (await homeOk(A)) && (await homeOk(B)) && (await homeOk(D)));

  // ---- A failed Key Trial, with a Coin: no throw
  await setPos(C, KEYS[0].spot);
  const coinC = await give(C, "djinn_coin");
  const found = await C.rpc("search_here", { p_hunt: huntId, p_lng: KEYS[0].spot.lng, p_lat: KEYS[0].spot.lat, p_mode: "walk" });
  if (found?.result !== "trial") check("C found Key 1's trial", false, JSON.stringify(found));
  else {
    const failed = await C.rpc("answer_trial", { p_attempt: found.trial.attempt, p_choice: 99 });
    check("a failed trial with a Coin: saved, and not thrown", failed?.result === "failed" && failed.saved === true && metres(await posOf(C), KEYS[0].spot) < 1, JSON.stringify(failed));
    check("…the Coin is spent", !!(await usedAt(coinC)));
  }

  // ---- Carpet of Kings: anywhere in the world (any time), and the step onto a road after landing
  const accra = { lng: -0.1870, lat: 5.6037 };
  const cp = await give(A, "carpet_of_kings");
  check("Carpet needs a place", (await A.rpc("use_wonder", { p_wonder: cp }))?.reason === "where");
  const cpUse = await A.rpc("use_wonder", { p_wonder: cp, p_lng: accra.lng, p_lat: accra.lat });
  check("Carpet flies A to Accra", cpUse?.ok && metres(await posOf(A), accra) < 1);
  const step = await A.rpc("save_position", { p_lng: accra.lng + 0.015, p_lat: accra.lat, p_mode: "walk" });
  check("…and A may step 1.7 km onto the nearest road, without tiring", step?.ok === true && step.energy > 90, JSON.stringify(step));

  // ---- Seer's Seal: on the Djinn's map, every decoy burns
  const ssl = await give(A, "seers_seal");
  const { data: wagers } = await admin.from("djinn_wagers").select("id, site_ids, real_site").lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()).is("winner", null).limit(1);
  check("the Seal off the Djinn's map: refused", (await A.rpc("use_wonder", { p_wonder: ssl }))?.reason === "no_map");
  if (!wagers?.length) console.log("no Wager on: the Seer's Seal burn is skipped");
  else {
    const w = wagers[0];
    entry = { wager_id: w.id, user_id: A.id };
    await admin.from("djinn_entries").insert({ ...entry, gate_score: 1, favour: 0, burned: [] });
    const sUse = await A.rpc("use_wonder", { p_wonder: ssl });
    const { data: e } = await admin.from("djinn_entries").select("burned").match(entry).single();
    check("the Seal burns every decoy, never the real place", sUse?.ok && e.burned.length === w.site_ids.length - 1 && !e.burned.includes(w.real_site));
  }

  // ---- The news
  const dNews = await D.rpc("wonder_news", { p_since: 0 });
  const mine = (await A.rpc("wonder_news", { p_since: 0 })).events.filter((e) => e.mine).length;
  check("every player hears of every use", dNews.events.filter((e) => e.wonder !== "djinn_coin").length >= 12, `${dNews.events.length} events`);
  check("the holder's own uses are marked theirs", mine >= 12, `${mine}`);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  // The news first (it names the test players), then the hunt, then the players.
  if (ids.length) await admin.from("wonder_events").delete().in("user_id", ids);
  if (huntId) {
    await admin.from("wonder_events").delete().eq("hunt_id", huntId);
    await admin.from("trial_attempts").delete().eq("hunt_id", huntId);
    await admin.from("hunt_players").delete().eq("hunt_id", huntId);
    await admin.from("hunt_keys").delete().eq("hunt_id", huntId);
    const { error } = await admin.from("hunts").delete().eq("id", huntId);
    if (error) console.log("hunt cleanup failed:", error.message);
  }
  if (entry) await admin.from("djinn_entries").delete().match(entry);
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
