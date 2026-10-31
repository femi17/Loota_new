---
name: new-story-hunt
description: Write a complete Loota story hunt (one continuous thriller story hiding N real places, 6+ plot decoys per key, a live piece per key, a trailer pack) and import it into its hunt, without the paid API. Use when the owner sends "/new-story-hunt <hunt id> <N> keys" (copied from a waiting hunt's card in the admin), or asks for a new story or today's hunt.
---

# New story hunt

The owner creates a hunt in the admin (Owner tools → New story hunt: keys, prize, winners; one hunt a day, made before 9 am on its day, always 9 am–9 pm Lagos) and sends
you the request on its card: `/new-story-hunt <hunt id> <N> keys`. You write the story here (no paid API: owner,
31 Oct 2026) and import it. Arguments: $ARGUMENTS

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

1. **The plan** (`skeleton`): title, logline, villain, heroes, world rules, chapters (a short cold open = 0, about one
   chapter per key, a short ending; one hero, one continuous day; chapter k holds key k and opens when key k − 1 is
   found, so never put a key's clue in a later chapter), and each key: question, answer (ONE exact place, e.g. the
   lighthouse not the fort, the gun not the hill; `searchName` that OpenStreetMap finds; `radius` 120 m, up to 300 for a
   canal or island fortress; aliases only if they land inside it), lockId,
   channelId, the conditions only the answer meets. Spread the keys around the world. Fiction woven into real places.
2. **Each key's design** (`designs["<n>"]`): solving steps, plants (chapter + detail), the live piece written out in full
   (the deciding piece AI can't read in advance: never in the chapters), and `check` data when the lock is an acrostic,
   letter shift or anagram (it must decode exactly: the importer works it out).
3. **Decoys** (`decoys["<n>"]`): 6+ per key, real places, each failing a named condition, at least radius + 100 m from
   the answer, including near misses next door (the hotel by the lighthouse) that the story rules out, types A/B/C, and each one a false trail IN THE PLOT (the villain's wrong race, a friend's wrong guess, a
   forged message), spread across scenes, never as a list.
4. **Chapters**: write each as `docs/stories/drafts/<date>-<id>/<n>.md` (plain prose, paragraphs separated by a blank
   line, 600–850 words; cold open ~300). One "aha" per key, planted earlier in a funny or emotional moment. Never name a
   key place or its aliases. Every chapter ends on a turn.
5. **Production** (`production`): the trailer pack: an art style, the characters' fixed looks, **3 picture prompts**
   (ChatGPT makes 3 a day; each complete on its own, 16:9, no text, never a key place recognisably), `trailer.voiceOver`
   (a ~45-second script for ElevenLabs, [NARRATOR]/[CHARACTER] lines) with `trailer.shots` (which lines over which
   picture), and voice directions. The scroll is text only.

Edit the JSON with small, careful edits (or a short node script) so it stays valid.

## 4. Attack it yourself

Before importing, reread the chapters as a rival solver with no live pieces. For each key: could you name the exact
place from the text alone? If yes, hide it deeper (move the deciding fact into the live piece, add decoys that fit the
loud clues). Could a careful player name it with the live piece? If not, add a plant. Say what you found in your report.

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
