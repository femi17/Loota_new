// Buying coins (Paystack test mode), through the game's own server on localhost:3000: a pack's checkout starts at
// Paystack and is recorded as pending; an unpaid purchase isn't credited; a genuine (signed) webhook credits the coins
// once, however often it comes; a forged webhook and a wrong amount are refused; a made-up pack, and someone else's
// purchase, are refused; and a real payment with Paystack's test card (charged through Paystack's API, as the
// checkout would) is confirmed by Paystack and credited. The test players are deleted.   node scripts/tests/coins-api-test.mjs
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
const app = createRequire(new URL("../../package.json", import.meta.url));
const { createClient } = app("@supabase/supabase-js");
const { createServerClient } = app("@supabase/ssr");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const GAME = "http://localhost:3000";
const ids = [];
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`); };

async function player(tag) {
  const email = `coins-${tag}-${Date.now()}@example.com`, password = `T3st-${Math.random().toString(36).slice(2)}!`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.push(data.user.id);
  const jar = new Map();
  const c = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: {
    getAll: () => [...jar].map(([n, value]) => ({ name: n, value })),
    setAll: (list) => list.forEach(({ name: n, value }) => (value ? jar.set(n, value) : jar.delete(n))) } });
  await c.auth.signInWithPassword({ email, password });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const post = (path, body) => fetch(`${GAME}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { id: data.user.id, post };
}
const coins = async (id) => (await admin.from("profiles").select("coins").eq("id", id).single()).data.coins;
const purchase = async (ref) => (await admin.from("coin_purchases").select("*").eq("reference", ref).maybeSingle()).data;
const webhook = (payload, secret = process.env.PAYSTACK_SECRET_KEY) => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha512", secret).update(raw).digest("hex");
  return fetch(`${GAME}/api/paystack/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sig }, body: raw }).then((r) => r.status);
};

try {
  const buyer = await player("buyer");
  const start = await coins(buyer.id);

  // ---- The checkout: Paystack starts it; the price is the server's
  const out = await buyer.post("/api/coins/checkout", { pack: "pouch", naira: 1, coins: 999999 });
  const ref = out.body?.reference;
  check("checkout: Paystack starts the payment", out.status === 200 && !!out.body?.accessCode && /^https:\/\/checkout\.paystack\.com\//.test(out.body?.url ?? ""), `${out.status} ${out.body?.url ?? JSON.stringify(out.body)}`);
  const row = await purchase(ref);
  check("…recorded as pending, at the server's price (the phone's numbers ignored)", row?.status === "pending" && row.coins === 1200 && row.amount_kobo === 100000, JSON.stringify(row));
  check("a made-up pack: refused", (await buyer.post("/api/coins/checkout", { pack: "free_coins" })).status === 400);

  // ---- Not paid: nothing credited
  const unpaid = await buyer.post("/api/coins/verify", { reference: ref });
  check("unpaid: no coins", (unpaid.body?.pending || unpaid.body?.failed) && (await coins(buyer.id)) === start, JSON.stringify(unpaid.body));

  // ---- Someone else can't check (or claim) it
  const other = await player("other");
  check("another player's purchase: refused", (await other.post("/api/coins/verify", { reference: ref })).status === 404);

  // ---- Webhooks: forged refused; genuine credits once; a wrong amount refused
  const paid = { event: "charge.success", data: { reference: ref, amount: 100000, currency: "NGN", status: "success" } };
  check("a forged webhook: refused", (await webhook(paid, "sk_test_not_the_real_one")) === 401 && (await coins(buyer.id)) === start);
  check("a genuine webhook: accepted", (await webhook(paid)) === 200);
  const after1 = await coins(buyer.id);
  check("…the coins added (1,200)", after1 === start + 1200, `${after1 - start}`);
  await webhook(paid);
  const again = await buyer.post("/api/coins/verify", { reference: ref });
  check("…once only, however often it's told", (await coins(buyer.id)) === after1 && (await purchase(ref)).status === "paid", `${(await coins(buyer.id)) - start} · ${JSON.stringify(again.body)}`);
  const tx = (await admin.from("coin_transactions").select("amount, kind, reason").eq("reference", `paystack:${ref}`)).data;
  check("…in the wallet's record as a purchase", tx?.length === 1 && tx[0].kind === "purchase" && tx[0].amount === 1200, JSON.stringify(tx));

  const cheap = await buyer.post("/api/coins/checkout", { pack: "vault" });
  await webhook({ event: "charge.success", data: { reference: cheap.body.reference, amount: 100, currency: "NGN", status: "success" } });
  check("paid the wrong amount: no coins", (await coins(buyer.id)) === after1 && (await purchase(cheap.body.reference)).status === "failed");

  // ---- A real payment: the test card charged at Paystack for a purchase of ours, then confirmed with Paystack
  const real = `loota_${randomUUID()}`;
  await admin.from("coin_purchases").insert({ reference: real, user_id: buyer.id, pack: "bag", coins: 3200, amount_kobo: 250000 });
  const charge = await fetch("https://api.paystack.co/charge", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "buyer@example.com", amount: 250000, reference: real, card: { number: "4084084084084081", cvv: "408", expiry_month: "12", expiry_year: "30" }, pin: "0000" }),
  }).then((r) => r.json());
  check("the test card charged at Paystack", charge.status === true, charge.message);
  const confirmed = await buyer.post("/api/coins/verify", { reference: real });
  check("…confirmed with Paystack: +3,200 coins", confirmed.body?.ok === true && confirmed.body.coins === 3200 && (await coins(buyer.id)) === after1 + 3200, JSON.stringify(confirmed.body));
} catch (e) {
  fails++;
  console.log("ERROR", e);
} finally {
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("cleanup failed:", error.message);
  }
  console.log(`test players deleted: ${ids.length}; ${fails ? `${fails} FAILED` : "all passed"}`);
}
