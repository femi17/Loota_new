// Home is a public spot, never an address (owner, 16 Nov 2026: "Fix 2 first"). A new test player:
//   1. sign-up says so ("never your exact address");
//   2. sets home at a spot in Lagos: what's stored is 200 m – 3 km from it (a bus stop 200–1,500 m away, or any stop
//      within 3 km), never the spot itself; the welcome coins still come;
//   3. moving home again within 30 days is still refused.
// The account is deleted.   node scripts/tests/home-privacy-test.mjs
import { createRequire } from "node:module";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };
const metres = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const chosen = { lng: 3.3792, lat: 6.5244 }; // Lagos Island
let id = null;

try {
  const email = `home-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  id = data.user.id;

  // 1. The sign-up page says so
  const jar = new Map();
  const ssr = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await ssr.auth.signInWithPassword({ email, password });
  const html = await (await fetch("http://localhost:3000/onboarding", { headers: { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") } })).text();
  check("1. sign-up: the hunter starts at a public spot, never the exact address", html.includes("never your exact address"));

  // 2. Setting home: a public spot near it is kept, not the spot
  const me = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await me.auth.signInWithPassword({ email, password });
  const { error } = await me.rpc("set_home", { lng: chosen.lng, lat: chosen.lat });
  check("2. home set", !error, error?.message);
  const p = (await admin.from("profiles").select("home_lng, home_lat, coins").eq("id", id).single()).data;
  const away = Math.round(metres(chosen, { lng: p.home_lng, lat: p.home_lat }));
  check("…what's stored is 200 m – 3 km from the spot chosen, not the spot", away >= 200 && away <= 3000, `${away} m`);
  const stop = (await admin.from("transit_stops").select("name, kind").eq("lng", p.home_lng).eq("lat", p.home_lat).limit(1)).data?.[0];
  check("…and it's a real stop (Lagos has plenty of bus stops)", !!stop, stop ? `${stop.kind}: ${stop.name}` : "a random point");
  check("…the welcome coins still came", Number(p.coins) >= 500, p.coins);

  // 3. The 30-day rule still holds
  const again = await me.rpc("set_home", { lng: chosen.lng + 0.01, lat: chosen.lat });
  check("3. moving home again straight away is refused", /30 days/.test(again.error?.message ?? ""), again.error?.message);
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  if (id) await admin.auth.admin.deleteUser(id);
  console.log(`test account deleted; ${fails ? `${fails} FAILED` : "all passed"}`);
  process.exit(fails ? 1 : 0);
}
