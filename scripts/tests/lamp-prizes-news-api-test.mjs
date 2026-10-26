// The lamp's new prizes and the world's news (owner, 26 Oct 2026: "the lamp only gives jerry can, it should give cruise
// and other things too… when a user picks a tool, all users should see an announcement"), through the real database
// functions. New Detours hold coins, relics, cruise tokens and tyre kits; winning cruise tokens or a tyre kit gives
// them; a relic picked up on the map and the lamp's prizes are news to another player (not coins), and to the finder
// it's marked as theirs. The Detours, finds and test players are deleted.
//   node scripts/tests/lamp-prizes-news-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ids = [];
const items = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const later = (s) => new Date(Date.now() + s * 1000).toISOString();
const yaba = { lng: 3.3787, lat: 6.5186 };
const cell = `${Math.floor(yaba.lng / 0.005)}:${Math.floor(yaba.lat / 0.005)}`;
const area = `test-${Date.now()}`;

async function player(tag) {
  const email = `${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = data.user.id;
  ids.push(id);
  const name = `${tag}${String(Date.now()).slice(-5)}`;
  await admin.from("profiles").update({ username: name, home_lng: yaba.lng, home_lat: yaba.lat, home_set_at: new Date().toISOString() }).eq("id", id);
  await admin.from("player_positions").upsert({ user_id: id, lng: yaba.lng, lat: yaba.lat, mode: "walk", energy: 100, updated_at: ago(60) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  return { id, name, rpc: async (fn, args) => (await c.rpc(fn, args)).data };
}

try {
  // ---- What new Detours hold: 150 spawned in a test area.
  for (let i = 0; i < 150; i++) await admin.rpc("spawn_detour", { p_area: area, p_lng: yaba.lng, p_lat: yaba.lat });
  const { data: spawned } = await admin.from("detours").select("reward_coins, reward_relic, reward_item, reward_qty, kind").eq("area", area);
  const count = (f) => spawned.filter(f).length;
  const tally = {
    coins: count((d) => d.reward_coins > 0),
    relics: count((d) => d.reward_relic),
    cruise: count((d) => d.reward_item === "cruise"),
    tyre: count((d) => d.reward_item === "tyre_kit"),
    jerry: count((d) => d.reward_relic === "jerry_can"),
  };
  check(`new Detours: ${spawned.length} spawned`, spawned.length >= 100, JSON.stringify(tally));
  check("…some hold cruise tokens (2–4)", tally.cruise > 0 && spawned.filter((d) => d.reward_item === "cruise").every((d) => d.reward_qty >= 2 && d.reward_qty <= 4));
  check("…some a tyre kit", tally.tyre > 0);
  check("…and coins and relics still", tally.coins > 0 && tally.relics > 0);
  check("…jerry cans only now and then", tally.jerry < spawned.length / 8, `${tally.jerry} of ${spawned.length}`);

  const finder = await player("Finder");
  const listener = await player("Listener");
  const first = await listener.rpc("world_news", { p_since: null });
  check("the first look at the news only sets the clock", first?.items?.length === 0 && !!first.now);
  const mineFirst = await finder.rpc("world_news", { p_since: null });

  const detour = async (row) => {
    const { data: d, error } = await admin.from("detours")
      .insert({ kind: "flash", area, title: "A test pouch", story: "Test", place_name: "Tejuosho Market", lng: yaba.lng, lat: yaba.lat, ends_at: later(1800), ...row })
      .select("id").single();
    if (error) throw error;
    return d.id;
  };
  const win = async (d) => {
    const s = await finder.rpc("start_detour", { p_detour: d });
    if (!s?.ok) return s;
    const { data: claim } = await admin.from("detour_claims").select("question").eq("detour_id", d).eq("user_id", finder.id).single();
    return finder.rpc("answer_detour", { p_detour: d, p_choice: Number(claim.question.answer) });
  };
  const tokens = async () => (await admin.from("profiles").select("cruise_tokens").eq("id", finder.id).single()).data.cruise_tokens;

  // ---- Winning the new prizes
  const before = await tokens();
  let r = await win(await detour({ reward_item: "cruise", reward_qty: 3 }));
  check("won cruise tokens: 3 more", r?.outcome === "won" && r.item === "cruise" && r.qty === 3 && (await tokens()) === Math.min(8, before + 3), `${before} → ${await tokens()}`);
  r = await win(await detour({ reward_item: "tyre_kit", reward_qty: 1 }));
  const { data: kit } = await admin.from("player_items").select("qty").eq("user_id", finder.id).eq("item", "tyre_kit").maybeSingle();
  check("won a tyre kit: in the bag", r?.outcome === "won" && r.item === "tyre_kit" && kit?.qty === 1, JSON.stringify(r));
  r = await win(await detour({ reward_coins: 60 }));
  check("won coins (not news)", r?.outcome === "won" && r.coins > 0);

  // ---- A relic picked up on the map
  const { data: it, error: iErr } = await admin.from("world_items").insert({ cell, kind: "relic", relic: "shield", lng: yaba.lng, lat: yaba.lat, expires_at: later(3600) }).select("id").single();
  if (iErr) throw iErr;
  items.push(it.id);
  const picked = await finder.rpc("pickup_item", { p_item: it.id, p_lng: yaba.lng, p_lat: yaba.lat, p_mode: "walk" });
  check("picked up a Shield on the map", picked?.ok === true && picked.relic === "shield", JSON.stringify(picked));

  // ---- The news
  const news = await listener.rpc("world_news", { p_since: first.now });
  const theirs = (news?.items ?? []).filter((n) => n.who === finder.name);
  check("another player hears: the cruise tokens from the lamp", theirs.some((n) => n.kind === "lamp" && n.prize === "cruise" && n.qty === 3 && n.place === "Tejuosho Market" && !n.mine), JSON.stringify(theirs));
  check("…the tyre kit", theirs.some((n) => n.kind === "lamp" && n.prize === "tyre_kit"));
  check("…the Shield picked up", theirs.some((n) => n.kind === "relic" && n.prize === "shield"));
  check("…and not the coins", theirs.length === 3, `${theirs.length} items`);
  const own = await finder.rpc("world_news", { p_since: mineFirst.now });
  check("the finder's own news is marked theirs (not shown to them)", (own?.items ?? []).filter((n) => n.who === finder.name).every((n) => n.mine));
  const { error: direct } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).rpc("announce", { p_user: finder.id, p_kind: "relic", p_prize: "radar", p_qty: 1, p_place: null });
  check("nobody can post news themselves", !!direct);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (items.length) await admin.from("world_items").delete().in("id", items);
  const { data: ds } = await admin.from("detours").select("id").eq("area", area);
  if (ds?.length) {
    await admin.from("detour_claims").delete().in("detour_id", ds.map((d) => d.id));
    await admin.from("detours").delete().in("id", ds.map((d) => d.id));
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  console.log(`Detours, finds and test players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
}
