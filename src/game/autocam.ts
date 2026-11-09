/**
 * The broadcast's auto camera: who to show next when the current turn is up (owner, 3 Nov 2026: each hunter a minute,
 * the whole field between rounds; 9 Nov 2026: "it shows a users, then back to the map to shows all users, then it went
 * straight back to the same user it has shown before. I think the logic is broken"). Everyone on the map has a turn,
 * leaders first, each once a round; then the whole field; then a new round. One hunter only: stay on them. Someone
 * doing something (`wanted`) goes next, never the one already shown.
 *
 * `here`: the hunters on the map, leaders first; `current`: the hunter shown, or "field"; `seen`: who has had a turn
 * this round (updated); `last`: the hunter shown last. Returns the next view: a hunter's id, or "field".
 */
export function nextAutoView(here: string[], current: string, seen: Set<string>, wanted: string | null, last: string | null): string {
  if (!here.length) return "field";
  if (here.length === 1) return here[0];
  if (current !== "field") seen.add(current);
  let next = wanted && here.includes(wanted) && wanted !== current ? wanted : (here.find((id) => !seen.has(id)) ?? null);
  if (!next) {
    // Everyone's had their turn: the whole field, then a new round (not starting with whoever was shown last)
    seen.clear();
    if (current !== "field") return "field";
    next = here.find((id) => id !== last) ?? here[0];
  }
  seen.add(next);
  return next;
}
