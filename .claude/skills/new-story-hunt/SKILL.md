---
name: new-story-hunt
description: Write a complete Loota story hunt (one continuous thriller story hiding N real places, 6+ plot decoys per key, a live piece per key, a trailer pack) and import it into its hunt, without the paid API. Use when the owner sends "/new-story-hunt <hunt id> <N> keys" (copied from a waiting hunt's card in the admin), or asks for a new story or today's hunt.
---

# New story hunt

The owner creates a hunt in the admin (Owner tools → New story hunt: keys, prize, winners; one hunt a day, made before 9 am on its day, always 9 am–9 pm Lagos) and sends
you the request on its card: `/new-story-hunt <hunt id> <N> keys`. You write the story here (no paid API: owner,
31 Oct 2026) and import it. Arguments: $ARGUMENTS

**Worldwide or Nigeria** (owner, 7 Nov 2026: "The hunt creation should have the option of worldwide and Nigeria"):
the owner picks "Where" when making the hunt, and a Nigeria hunt's request ends in `Nigeria`
(`/new-story-hunt <id> 5 keys Nigeria`); `story:pick` prints "Where:". In a Nigeria hunt EVERY key, alias and
decoy is a real place in Nigeria (spread over several cities and states, not all Lagos), and its clues may rest on what
anyone who grew up in or follows Nigeria knows (its music, football, history, food, landmarks, Nollywood), still never
street-level local knowledge. The importer checks each place's country and refuses one outside Nigeria. Worldwide hunts
keep every rule below as written.

Work in `C:\Users\oduol\loota`. The bar is high: the owner rejected stories that were "too easy" or "not the juice", and then one that read "like work, not a thrill", jumped between eras and people ("the story does not tally"), and parked its decoys together. Fun first.
Read the Bible in full every time, and meet every rule in it.

## 1. Picks

```
npm run story:pick -- --hunt <hunt id>
```

It prints the genre, the theme, and for each key its **lock** (the kind of puzzle) and **channel** (how the live piece
reaches players), plus everything earlier stories used (never reuse it), and the draft file path
(`docs/stories/drafts/<date>-<id>.json`). Without a hunt id: `--keys N`.

## 2. Read the brief

`src/lib/story/bible.ts` (the Bible: rules, decoy types, craft) and the shapes in `src/lib/story/engine.ts`
(`STORY_SHAPES`: Skeleton, KeyDesign, Decoys, Production; their `.describe()` texts explain each field).

## 3. Write, in this order, into the draft

1. **The plan** (`skeleton`): title, logline, villain (a rival with a copy is enough), heroes, world rules, chapters
   (THE ENVELOPE FORMAT, owner, 1 and 3 Nov 2026: a short frame = 0, then one envelope per key, a two-line ending; chapter
   k is envelope k, opens when key k − 1 is found, and holds everything key k needs and nothing for another key), and
   each key: question, answer (ONE exact place, e.g. the
   lighthouse not the fort, the gun not the hill; `searchName` that OpenStreetMap finds; `radius` 120 m, up to 300 for a
   canal or island fortress; aliases only if they land inside it), lockId,
   channelId, the conditions only the answer meets. Spread the keys around the world (a Nigeria hunt: around Nigeria). Fiction woven into real places.
2. **Each key's design** (`designs["<n>"]`): solving steps, plants (chapter + detail), the live piece written out in full
   (the deciding piece AI can't read in advance: never in the chapters), and `check` data when the lock is an acrostic,
   letter shift or anagram (it must decode exactly: the importer works it out). And its **quarter** (written as `house`,
   every key: owner, 1 Nov 2026, never a chest in the open): the person's own corner of that place, an open street,
   lane or square the hunter walks freely (`style`, and `layout`: hall = a lane, gallery = a street, court = a square),
   5 plots at Key 1 growing to 7 at the last, each an OUTDOOR place named as such (its `kind`: kitchen = food stall,
   bedroom = cottage, library = book stall, cellar = well, parlour = café, bathroom = fountain, chapel = shrine,
   storeroom = yard, study = garden); one right plot (where the key is) the key's own envelope points to, trap plots that echo the near misses the story warns about, and at least 2 EMPTY (safe) plots: just nothing (owner, 3 Nov 2026: "some houses might be empty, no decoy just nothing"); things to find and
   items only in some quarters (bible 3b). Each plot is a building (walked into: the right one holds the key's chest, a 60-second puzzle; the coins, next chapter, fake chest and trap are boxes in the town's own small houses, not story places) or
   OPEN-AIR (`"outdoor": true`: a yard, a garden, a well, a square; dug: the right one holds a buried chest, "no need to
   enter a house, the metal detector helps here"). Mix them: in some quarters the key is in a building, in others buried. Walking into a
   building searches it (a trap building springs as the hunter goes in). Give each quarter a `scene` so the key's
   world looks like the place: `{ "ground": "city" | "salt" | "desert", "pieces": [...] }` from station, dog-statue,
   scramble, screens, clock-station, river, brick-station, trolley-wall, rusty-engines, water-tower, tracks,
   two-engines, golden-spike (bible 3b).
3. **Decoys** (`decoys["<n>"]`): 3+ per key (the short format, owner, 1 Nov 2026), real places a search finds, each
   failing a named condition, at least radius + 200 m from the answer: the near miss next door the clue rules out (the
   studio beside the crossing), the famous wrong reading the wording invites, a rival's wrong guess. Each is a phrase in
   the story, never a list, and each is a TRAP on the map (stopping there springs one).
4. **Chapters**: write each as `docs/stories/drafts/<date>-<id>/<n>.md` (plain prose, paragraphs separated by a blank
   line), in THE ENVELOPE FORMAT (bible 1, with the model "The Collector's Envelopes"): a frame of 40–90 words (who, why,
   "be quick: someone has a copy"), then each key's envelope, 40–90 words: ONE riddle for one place, its near misses ruled
   out in a line ("Everyone goes to the building beside it. Don't. Stand on the stripes."), and THE HINT: a line on where in
   the quarter the treasure is and what to leave alone, said as the place is: "search the noodle stall" for a building,
   "dig where the water tank stands; your metal detector will sing" for buried treasure (owner, 3 Nov 2026: "It must be
   part of the hint mentioned in each chapter"); a two-line ending. One page a chapter (owner, 3 Nov 2026): the scroll shows the
   frame and envelope 1 together, so keep those two under ~170 words. No subplot, no rival's crew, no codes or plants across
   chapters. Each clue rests on GENERAL KNOWLEDGE from any walk of life (music, sport, science, film, food, history,
   nature, landmarks), fair to a player anywhere in the world, never local knowledge; the trick is in the wording. The
   real fight is at the place (the quarter and its puzzle). Never name a key place or its aliases.
5. **Production** (`production`): the trailer pack: an art style, the characters' fixed looks, **3 picture prompts**
   (ChatGPT makes 3 a day; each complete on its own, 16:9, no text, never a key place recognisably), `trailer.voiceOver`
   (a ~45-second narration for ElevenLabs: ONE narrator, third person, inviting players to help the hero win the prize;
   only the words spoken, no names, brackets or stage directions) with `trailer.shots` (which lines over which
   picture), and voice directions. The scroll is text only.

Edit the JSON with small, careful edits (or a short node script) so it stays valid.

## 4. Attack it yourself

Before importing, reread each envelope as a rival solver. Can a careful player with general knowledge name the exact
place from that envelope alone (it should be one "aha", not a giveaway in the first words)? Does the last detail say what the spot IS (a statue, the stripes, the lighthouse), so a
player who reaches the neighbourhood (Shibuya station) knows to walk on to it (the bronze dog), and does the envelope
pin the city or country? Does each near miss tempt
someone who solved only half of it? Does the envelope's hint say which plot (search it, or dig there), and that the detector helps? Say what you found in your report.

## 5. Check, then import

```
npm run story:import -- docs/stories/drafts/<date>-<id>.json --chapters docs/stories/drafts/<date>-<id> --check
```

It checks the shape, every code, every chapter for leaked names, 20+ decoys per key, then every answer, alias and decoy
on the game's map (a few minutes). Fix every ✗ and rerun. (! lines are warnings: an alias the map misses can be added to
the game's own places later; a decoy not on the map is fine in the text.) Then import for real:

```
npm run story:import -- docs/stories/drafts/<date>-<id>.json --chapters docs/stories/drafts/<date>-<id> --hunt <hunt id>
```

The hunt gets the story's title and description, a key at each real place (snapped to a road, asked by the key's
question), a picture slot per prompt, and a registry row; the PDFs land in `docs/stories/<date>-<slug>/`.

## 6. Report to the owner (plain words)

The title and logline; the five checks; how many picture prompts are waiting in the admin (the hunt's card: Copy prompt,
Upload picture); the PDFs' paths; anything you couldn't fix. Give the answers only in a clearly marked spoiler section.
Remind them which live channels still need a game feature (`[game feature to build]` in the picks) before real players
can solve those keys.
