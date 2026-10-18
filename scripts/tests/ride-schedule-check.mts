// The ride timetable (src/game/rideSchedule.ts) and the traffic lights' cycle (src/game/signals.ts), without a browser:
// a 2 km ride of 120 s with a go-slow from 800 m to 1300 m, a bus stop at 500 m and a light at 1600 m.
//   node --import ./scripts/tests/ts-ext.mjs scripts/tests/ride-schedule-check.mts
import { planRide, rideAt } from "../../src/game/rideSchedule.ts";
import { SIGNAL_CYCLE_MS, signalState, waitForGreen } from "../../src/game/signals.ts";

let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

// The light: green 9 s, amber 2 s, red 9 s, every 20 s.
const counts = { green: 0, amber: 0, red: 0 };
for (let ms = 0; ms < SIGNAL_CYCLE_MS; ms += 100) counts[signalState(4242, ms).light]++;
check("a light is green 9 s, amber 2 s, red 9 s every 20 s", counts.green === 90 && counts.amber === 20 && counts.red === 90, JSON.stringify(counts));
let ok = true;
for (let ms = 0; ms < SIGNAL_CYCLE_MS; ms += 250) {
  const w = waitForGreen(4242, ms);
  if (w > 0 && signalState(4242, ms + w).light !== "green") ok = false;
  if (w > 0 && signalState(4242, ms + w - 300).light === "green") ok = false;
}
check("…waiting for green ends just as it turns green", ok);

const cum = Array.from({ length: 41 }, (_, i) => i * 50); // 2 km in 50 m pieces
const jams = cum.slice(1).map((s) => (s > 800 && s <= 1300 ? 2 : 0));
const leaves = 1_000_000;
const rideMs = 120_000;
// A light that is red when the bus gets there (whatever the timing): always 20 s to wait.
const plan = planRide(cum, jams, [{ s: 500, dwell: 5000 }], [{ s: 1600, id: 7 }], () => 20_000, leaves, rideMs);
const at = (ms: number) => rideAt(plan, cum, ms);
check("it reaches the end exactly when the server says", Math.abs(at(rideMs).s - 2000) < 1 && at(rideMs - 3000).s < 2000, `${at(rideMs - 3000).s.toFixed(0)} m 3 s before`);
let last = -1;
let forward = true;
for (let ms = 0; ms <= rideMs; ms += 200) {
  const s = at(ms).s;
  if (s < last - 1e-6) forward = false;
  last = s;
}
check("never goes backwards", forward);
const stop = plan.holds.find((h) => h.kind === "stop")!;
const light = plan.holds.find((h) => h.kind === "signal")!;
check("stands at the bus stop for its 5 s", at(stop.at + 2000).s === 500 && at(stop.at + 2000).at === stop, `${(stop.at / 1000).toFixed(1)} s`);
check("waits 6 m before the red light for 20 s", light.s === 1594 && light.dwell === 20_000 && at(light.at + 10_000).at === light);
// Speed in the jam against on clear road: the go-slow is 1/0.15 as slow.
const speed = (from: number) => (at(from + 1000).s - at(from).s) / 1; // m per s
const t800 = plan.costCum[16] / plan.perMs + stop.dwell; // reaching 800 m
const inJam = speed(t800 + 3000);
const clear = speed(1000);
check("crawls through the go-slow, faster on clear road", inJam > 0 && clear / inJam > 6 && clear / inJam < 7, `${clear.toFixed(1)} vs ${inJam.toFixed(1)} m/s`);
check("…and says it's in the go-slow", at(t800 + 3000).jam === 2 && at(1000).jam === 0);
// With the real lights (15 junctions in 3 km, as on Victoria Island): every wait is at a light that is red (or
// amber) when the vehicle gets there and ends as it turns green; every light passed without waiting is green.
const cum3 = Array.from({ length: 61 }, (_, i) => i * 50);
const lights15 = Array.from({ length: 15 }, (_, i) => ({ s: 120 + i * 190, id: 1000 + i * 37 }));
let honest = true;
let waits = 0;
let early = Infinity;
let late = 0;
for (let start = 0; start < 40_000; start += 2_300) {
  const p = planRide(cum3, cum3.slice(1).map(() => 0), [], lights15, waitForGreen, leaves + start, 60_000);
  for (const h of p.holds) {
    const arrive = leaves + start + h.at;
    if (h.dwell > 0) {
      waits++;
      if (signalState(h.ref, arrive).light === "green" || signalState(h.ref, arrive + h.dwell).light !== "green") honest = false;
    } else if (signalState(h.ref, arrive).light !== "green") honest = false;
  }
  if (p.ends <= 60_000) early = Math.min(early, 60_000 - p.ends);
  else late = Math.max(late, p.ends - 60_000);
  if (Math.abs(rideAt(p, cum3, p.ends).s - 3000) > 1) honest = false;
}
check("waiting at lights matches their colours exactly (no red run)", honest, `${waits} waits over 18 rides of 60 s through 15 lights`);
check("…the ride fills its time, or runs over only where the lights demand it", (early === Infinity || early < 12_000) && late < 30_000, `early by ${early === Infinity ? "–" : (early / 1000).toFixed(1)} s at most, late by ${(late / 1000).toFixed(1)} s at most`);
// An ordinary ride: 3 lights in 3 km, 60 s: never late.
let lateOrdinary = 0;
for (let start = 0; start < 40_000; start += 1_700) {
  const p = planRide(cum3, cum3.slice(1).map(() => 0), [], [lights15[2], lights15[7], lights15[12]], waitForGreen, leaves + start, 60_000);
  lateOrdinary = Math.max(lateOrdinary, p.ends - 60_000);
}
check("…with a few lights on the way it is never late", lateOrdinary <= 0, `${lateOrdinary} ms`);
console.log(fails ? `${fails} FAILED` : "all passed");
