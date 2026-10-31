# The Loota story engine

Makes one complete treasure-hunt story a day: a novel-length thriller hiding real places around the world, with 20+ decoys per key, a live piece per key that only the game hands out, picture prompts and voice directions. Nothing it has used before is ever used again.

## Every day

```
npm run story:new
```

Options: `--keys 5` · `--genre "spy thriller"` · `--theme "a train that never arrived"` · `--start "East Africa"` · `--writer opus` (finer writing, costs more) · `--dry` (shows today's picks without writing anything).

It takes 10–20 minutes and costs about a dollar with the default writer. Everything lands in `docs/stories/<date>-<title>/`:

- **story.pdf**: the story for players. It never names a key place.
- **answers.pdf**: for you only. Every key's answer, conditions, solving steps, live piece, decoys, and the check results.
- **story.json**: everything, for the game to load.
- **report.md**: pass/fail for each check, and the cost.

## What the engine checks for you

1. **Codes:** acrostics, ciphers and anagrams are decoded by computer.
2. **Map:** every answer, alias and decoy is searched on the same map the game uses. A decoy within 1 km of its answer fails.
3. **Leaks:** no chapter may name a key place. A leaking chapter is rewritten once automatically.
4. **AI attack:** a second AI reads the story without the live pieces and tries to find the places. It should fail. With the live pieces, it should succeed; if it can't, the key is unfair.

## Before you publish (10 minutes)

- Open answers.pdf. All five checks at the top should be ✓.
- Read each key's live piece. Is it clear and fun?
- Any decoy marked in red on the map: fine to leave in the story, but it can't hold a trap chest.
- Skim the story. Does it grip you? If not, run again; each run is a new story.

## Using the Bible by hand

`BIBLE.md` is the full brief. Paste it into any AI chat (Claude, ChatGPT), then add: the genre, the theme, the number of keys, and which lock and channel each key uses (from `library.mts`). Ask for the plan first, then the decoys, then the chapters one by one.

## Adding new tricks

- **New lock** (kind of puzzle) or **new channel** (how a live piece reaches players): add a line to `library.mts`. The engine starts using it next time, least-used first.
- Channels marked `to-build` need a game feature before a story using them can be played. Today `radio`, `shopkeeper`, `lounge-board`, `lamp-whisper` and `road-stranger` are closest to ready.

## The registry

`docs/stories/registry.json` lists every story's places, decoys, characters, titles, locks and channels. The engine never reuses a place, decoy, character or title, and picks the locks and channels used longest ago. Keep this file in git.
