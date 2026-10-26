// Riding and driving tire you (owner, 26 Oct 2026: "Even when someone is riding a motorbike or driving a car, their
// energy should still deplete so we can tell them to go rest"), in the game's movement rules: full energy lasts about
// 14 minutes riding a motorbike and 21 driving a car (5 walking); out of energy on a motorbike you stop, without fainting,
// and don't go on until 15 is back; a walker out of energy faints as before; and the server counts it the same
// (energy_per_m).
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/driving-tires-check.mts
import { createClient } from "@supabase/supabase-js";
import * as movement from "@/game/movement";
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};
const at = { lng: 3.3787, lat: 6.5186 };

/** Seconds of going flat out until energy runs out (or the hunter faints), stepping 0.1 s. */
function lasts(mode: movement.Mode) {
  const t = movement.createTraveller(at, mode);
  t.energy = 100;
  let s = 0;
  while (t.energy > 0 && t.phase === "idle" && s < 3600) {
    movement.step(t, { go: true, sprint: false }, 0.1, s, true);
    s += 0.1;
  }
  return { s, t };
}
for (const [mode, lo, hi] of [["walk", 4, 6], ["motorbike", 12, 16], ["car", 18, 24]] as const) {
  const { s } = lasts(mode);
  check(`${mode}: a full bar lasts ${lo}–${hi} min going flat out`, s / 60 >= lo && s / 60 <= hi, `${(s / 60).toFixed(1)} min`);
}

// Out of energy on a motorbike: stopped, not fainted; on again only from 15.
const { t } = lasts("motorbike");
check("out of energy on a motorbike: not fainted", t.phase === "idle" && t.energy === 0, `${t.phase} ${t.energy}`);
for (let i = 0; i < 30; i++) movement.step(t, { go: true, sprint: false }, 0.1, 100 + i, true);
check("…and it won't go (pressing go)", t.v < 0.5, `v ${t.v.toFixed(2)}`);
// Rest by the road until 15 is back.
t.resting = true;
t.restRate = movement.ROADSIDE_REGEN;
let tt = 200;
while (t.energy < 14) {
  movement.step(t, { go: false, sprint: false }, 0.1, tt, true);
  tt += 0.1;
}
t.resting = false;
for (let i = 0; i < 20; i++) movement.step(t, { go: true, sprint: false }, 0.1, tt + i, true);
check("…at 14, still won't go", t.v < 0.5, `energy ${t.energy.toFixed(1)}, v ${t.v.toFixed(2)}`);
t.resting = true;
while (t.energy < 16) {
  movement.step(t, { go: false, sprint: false }, 0.1, tt, true);
  tt += 0.1;
}
t.resting = false;
for (let i = 0; i < 30; i++) movement.step(t, { go: true, sprint: false }, 0.1, tt + i, true);
check("…rested to 15+: on again (slowly, tired)", t.v > 0.5, `energy ${t.energy.toFixed(1)}, v ${t.v.toFixed(2)}`);

// A walker out of energy still faints.
const w = lasts("walk");
check("a walker out of energy faints, as before", w.t.phase === "fainted");

// The server counts the same energy per metre.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
for (const mode of ["walk", "bicycle", "motorbike", "car"] as const) {
  const { data } = await admin.rpc("energy_per_m", { p_mode: mode });
  const mine = movement.MODES[mode].drain / movement.baseSpeed(mode);
  check(`the server's energy per metre ${mode}: the same as the game's`, data !== null && Math.abs(Number(data) - mine) < 1e-9, `${Number(data).toFixed(5)} vs ${mine.toFixed(5)}`);
}
console.log(fails ? `${fails} FAILED` : "all passed");
