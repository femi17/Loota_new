// Clans (owner, 31 Oct 2026: "clan up or solo… they can join a clan where they share resources… This will handle
// referral"; hunters win alone, the clan helps; up to 5; chat, the map, items, Wonders and coins between clanmates; an
// invite link, and bonus coins for both when the new player joins their first hunt).
//   1. A starts a clan; the same name can't be used twice (any case); A can't start a second.
//   2. B (new) joins with A's invite code: a referral is recorded; C (new) and D, E join; F is refused (5 is the most).
//   3. The chat: B says something, A reads it; too many messages in a row are refused.
//   4. The map: A sees B where B stands; G (no clan) sees nobody.
//   5. Gifts: A gives B coins (both balances right), a relic and a Wonder; G (not a clanmate) can't receive.
//   6. B joins a hunt: A and B each get 250 coins, once.
//   7. A (the leader) leaves: the lead passes to B; A's clan is gone for A.
// Everything made is deleted.   node scripts/tests/clans-api-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const users = [];
let clanId = null, hunt = null;
const NAME = `Test Clan ${Date.now().toString(36)}`;

async function player(tag) {
  const email = `clan-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  users.push(data.user.id);
  await admin.from("profiles").update({ home_lng: 3.3787, home_lat: 6.5186, home_set_at: new Date().toISOString(), coins: 1000 }).eq("id", data.user.id);
  await admin.from("player_positions").upsert({ user_id: data.user.id, lng: 3.3787 + users.length * 0.001, lat: 6.5186, mode: "walk", energy: 100, updated_at: ago(30) });
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password });
  const rpc = async (fn, args = {}) => { const r = await c.rpc(fn, args); if (r.error) throw r.error; return r.data; };
  return { id: data.user.id, rpc };
}
const coins = async (id) => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;

try {
  const [A, B, C, D, E, F, G] = await Promise.all(["a", "b", "c", "d", "e", "f", "g"].map(player));

  // 1. Start a clan
  const made = await A.rpc("create_clan", { p_name: NAME, p_crest: "🦁", p_colour: "#2EC4B6" });
  clanId = made.clan;
  check("A starts a clan", made.ok === true && !!clanId, JSON.stringify(made));
  check("…the same name, any case, is taken", (await G.rpc("create_clan", { p_name: NAME.toUpperCase(), p_crest: "🐍", p_colour: "#000000" })).reason === "taken");
  check("…and A can't start a second", (await A.rpc("create_clan", { p_name: NAME + " two", p_crest: "🦁", p_colour: "#2EC4B6" })).reason === "in_clan");
  const mine = await A.rpc("my_clan");
  check("A's clan: name, crest, A as leader, an invite code", mine.clan?.name === NAME && mine.clan.crest === "🦁" && mine.me.role === "leader" && /^[0-9A-F]{8}$/.test(mine.me.invite), JSON.stringify(mine.me));
  const code = mine.me.invite;
  const invite = await G.rpc("clan_of_invite", { p_code: code.toLowerCase() });
  check("the invite page knows the clan (any case)", invite?.name === NAME && invite.members === 1, JSON.stringify(invite));

  // 2. Join; the limit
  check("B joins with A's code", (await B.rpc("join_clan", { p_code: code })).ok === true);
  const { data: ref } = await admin.from("clan_referrals").select("inviter, rewarded_at").eq("invitee", B.id).maybeSingle();
  check("…a referral: B, brought by A", ref?.inviter === A.id && ref.rewarded_at === null, JSON.stringify(ref));
  for (const p of [C, D, E]) await p.rpc("join_clan", { p_code: code });
  const full = await F.rpc("join_clan", { p_code: code });
  check("five in the clan; the sixth is refused", full.ok === false && full.reason === "full" && (await A.rpc("my_clan")).members.length === 5, JSON.stringify(full));
  check("a wrong code is refused", (await F.rpc("join_clan", { p_code: "NOPE1234" })).reason === "code");

  // 3. The chat
  check("B says something", (await B.rpc("clan_say", { p_body: "The rock, not the town!" })).ok === true);
  const chat = await A.rpc("clan_chat", { p_after: 0 });
  check("A reads it, with who said it", chat.ok && chat.messages.some((m) => m.body === "The rock, not the town!" && !m.mine && m.by), JSON.stringify(chat.messages.at(-1)));
  let slow = null;
  for (let i = 0; i < 6; i++) slow = await B.rpc("clan_say", { p_body: `spam ${i}` });
  check("…too many messages in a row: slow down", slow.reason === "slow");
  check("G (no clan) has no chat", (await G.rpc("clan_chat", { p_after: 0 })).ok === false);

  // 4. The map
  const pos = await A.rpc("clan_positions");
  const b = pos.mates.find((m) => m.id === B.id);
  check("A sees B on the map, where B stands", !!b && Math.abs(b.lat - 6.5186) < 1e-6 && pos.mates.length === 4 && pos.colour === "#2EC4B6", `${pos.mates.length} mates`);
  check("G sees nobody", (await G.rpc("clan_positions")).mates.length === 0);

  // 5. Gifts
  const [a0, b0] = [await coins(A.id), await coins(B.id)];
  const gift = await A.rpc("clan_give_coins", { p_to: B.id, p_amount: 150 });
  check("A gives B 150 coins", gift.ok && (await coins(A.id)) === a0 - 150 && (await coins(B.id)) === b0 + 150, JSON.stringify(gift));
  check("…not more than A has", (await A.rpc("clan_give_coins", { p_to: B.id, p_amount: 5000 })).reason === "coins");
  check("…never to someone outside the clan", (await A.rpc("clan_give_coins", { p_to: G.id, p_amount: 10 })).reason === "not_mate");
  const { data: relic } = await admin.from("player_relics").insert({ user_id: A.id, relic: "shield", charges: 1, expires_at: new Date(Date.now() + 86400e3).toISOString() }).select("id").single();
  const { data: wonder } = await admin.from("player_wonders").insert({ user_id: A.id, wonder: "phantom_cloak" }).select("id").single();
  const giftables = await A.rpc("clan_giftables");
  check("A's giftables: the relic and the Wonder", giftables.relics.some((r) => r.id === relic.id) && giftables.wonders.some((w) => w.id === wonder.id));
  check("A gives B the relic", (await A.rpc("clan_give_relic", { p_relic: relic.id, p_to: B.id })).ok && (await admin.from("player_relics").select("user_id").eq("id", relic.id).single()).data.user_id === B.id);
  check("A gives B the Wonder", (await A.rpc("clan_give_wonder", { p_wonder: wonder.id, p_to: B.id })).ok && (await admin.from("player_wonders").select("user_id").eq("id", wonder.id).single()).data.user_id === B.id);
  check("…and can't give it again", (await A.rpc("clan_give_wonder", { p_wonder: wonder.id, p_to: C.id })).reason === "item");

  // 6. The referral pays at B's first hunt
  const [a1, b1] = [await coins(A.id), await coins(B.id)];
  const { data: h } = await admin.from("hunts").insert({ title: "Clan test (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: false }).select("id").single();
  hunt = h.id;
  await admin.from("hunt_players").insert({ hunt_id: hunt, user_id: B.id });
  const [a2, b2] = [await coins(A.id), await coins(B.id)];
  check("B joins a hunt: A and B each get 250 coins", a2 === a1 + 250 && b2 === b1 + 250, `A +${a2 - a1}, B +${b2 - b1}`);
  const { data: h2 } = await admin.from("hunts").insert({ title: "Clan test 2 (automated)", prize: "none", winners: 1, starts_at: ago(3600), ends_at: new Date(Date.now() + 3600e3).toISOString(), published: false }).select("id").single();
  await admin.from("hunt_players").insert({ hunt_id: h2.id, user_id: B.id });
  check("…once only", (await coins(A.id)) === a2 && (await coins(B.id)) === b2);
  await admin.from("hunts").delete().eq("id", h2.id);

  // 7. Leaving
  check("A leaves", (await A.rpc("leave_clan")).ok === true && (await A.rpc("my_clan")).clan === null);
  const bView = await B.rpc("my_clan");
  check("…the lead passes to B (the longest standing)", bView.me.role === "leader" && bView.members.length === 4, JSON.stringify(bView.me));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (hunt) await admin.from("hunts").delete().eq("id", hunt);
  if (clanId) await admin.from("clans").delete().eq("id", clanId);
  for (const u of users) await admin.auth.admin.deleteUser(u);
  console.log(`test clan, hunts and players deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
