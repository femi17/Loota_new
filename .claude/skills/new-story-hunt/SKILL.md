---
name: new-story-hunt
description: Write a complete Loota story hunt (a thriller story hiding N real places, 20+ decoys per key, a live piece per key, picture prompts) and import it into its hunt, without the paid API. Use when the owner sends "/new-story-hunt <hunt id> <N> keys" (copied from a waiting hunt's card in the admin), or asks for a new story or today's hunt.
---

# New story hunt

The owner creates a hunt in the admin (Owner tools → New story hunt: keys, prize, winners; it takes the next day without a hunt, always 9 am–9 pm Lagos) and sends
you the request on its card: `/new-story-hunt <hunt id> <N> keys`. You write the story here (no paid API: owner,
31 Oct 2026) and import it. Arguments: $ARGUMENTS

Work in `C:\Users\oduol\loota`. The bar is high: the owner rejected stories that were "too easy" or "not the juice".
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

1. **The plan** (`skeleton`): title, logline, villain, heroes, world rules, chapters (prologue = 0, about keys + 1
   chapters, epilogue), and each key: question, answer (`searchName` that OpenStreetMap finds, aliases), lockId,
   channelId, the conditions only the answer meets. Spread the keys around the world. Fiction woven into real places.
2. **Each key's design** (`designs["<n>"]`): solving steps, plants (chapter + detail), the live piece written out in full
   (the deciding piece AI can't read in advance: never in the chapters), and `check` data when the lock is an acrostic,
   letter shift or anagram (it must decode exactly: the importer works it out).
3. **Decoys** (`decoys["<n>"]`): 22+ per key, real places, each failing a named condition, at least 1 km from the
   answer, types A/B/C, woven into named chapters naturally (never as a list).
4. **Chapters**: write each as `docs/stories/drafts/<date>-<id>/<n>.md` (plain prose, paragraphs separated by a blank
   line, 1,000–1,400 words). Never name a key place or its aliases. Plant, then pay off. Every chapter ends on a turn.
5. **Production** (`production`): an art style, each character's fixed look, 3 picture prompts per chapter for ChatGPT
   (each complete on its own: style + looks + scene, 16:9, no text, never showing a key place recognisably), and a
   voice direction per speaker and per live piece (ElevenLabs).

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
