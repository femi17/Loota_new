/**
 * The story engine's library (owner, 30 Oct 2026: "it won't always be a radio, else users will have gotten used to it"):
 * the ways a key's deciding piece reaches players inside the game (channels), the kinds of puzzle that hide a place
 * (locks), and the genres and themes stories are drawn from. The engine picks the least recently used of each, so no
 * two days feel the same. `game` says whether the game can already deliver a channel or it still needs building.
 */

export type Channel = { id: string; name: string; how: string; game: "near" | "to-build" };
export type Lock = { id: string; name: string; how: string; check?: "acrostic" | "caesar" | "anagram" };

export const CHANNELS: Channel[] = [
  { id: "radio", name: "Hunt radio bulletin", how: "A station that exists only during the hunt plays recorded bulletins at set hours. The deciding words are in one bulletin; another, doctored one lies.", game: "near" },
  { id: "shopkeeper", name: "A character in a shop", how: "A cook, pump attendant, mechanic or ticket clerk at a real place says one extra line, or hands over an item, only to a player who says or brings the right thing.", game: "near" },
  { id: "lounge-board", name: "The departure board", how: "In an airport lounge or station hall, one line on the board (a flight number, a gate, a scrambled destination) shows only at one minute of the night, Lagos time.", game: "near" },
  { id: "phone-call", name: "A call that rings once", how: "When the player arrives at a place, the game rings: a character speaks once and hangs up. Miss it and it rings again in an hour.", game: "to-build" },
  { id: "voicemail", name: "A voicemail heard on site", how: "A recorded message the story mentions, which plays only when the player stands at a story place.", game: "to-build" },
  { id: "player-strip", name: "A clue different for every player", how: "Each player receives their own coded strip, letter or ticket in the bag. Every version decodes to the same place, so no answer sheet works for everyone.", game: "to-build" },
  { id: "bus-talk", name: "Overheard on the bus", how: "Riding a particular kind of bus or train in the game, the player overhears two passengers. One of them says the deciding detail.", game: "to-build" },
  { id: "lamp-whisper", name: "The Lamp's whisper", how: "The Lamp glows and offers a whisper: one sentence from a character, available for one hour after a set time.", game: "near" },
  { id: "notice-board", name: "A notice at a stop", how: "A notice pinned at a bus stop or market in one city: a lost-and-found, a wanted poster, a missing-person sign.", game: "to-build" },
  { id: "compass-tool", name: "A tool that points", how: "An item the story gives (a compass, a dowsing rod, a radio that hisses louder) that only reacts on the map, near the right spot.", game: "to-build" },
  { id: "dusk-event", name: "Only at dusk", how: "Something visible in the game world only while the real sun is setting where the player stands: a light in a window, a shadow, a lantern.", game: "to-build" },
  { id: "road-stranger", name: "A stranger on the road", how: "A traveller who stops the player in free roam or a hunt, and tells a short story with the deciding detail if the player helps them.", game: "near" },
];

export const LOCKS: Lock[] = [
  { id: "acrostic", name: "Acrostic", how: "The first letters of a character's sentences spell the place. Other messages beside it spell decoys.", check: "acrostic" },
  { id: "count-cipher", name: "Count cipher", how: "Letters shifted backwards (or forwards) through the alphabet by a number the reader had to count in the story.", check: "caesar" },
  { id: "time-zone", name: "Time zone", how: "A stated time, compared with another time planted in the story, reveals how far east or west a character is." },
  { id: "old-name", name: "Old or foreign name", how: "The place appears under a historic, colonial or foreign name that the story explains in passing, much earlier." },
  { id: "book-cipher", name: "Book cipher", how: "Numbers pointing to chapter, paragraph and word of the story itself spell the place." },
  { id: "witness", name: "Witness contradiction", how: "Several witnesses describe the same night. Only one account fits every planted fact, and it names the place." },
  { id: "anagram", name: "Anagram", how: "Scrambled letters (a torn label, a jumbled sign) that unscramble to the place. Other jumbles unscramble to decoys.", check: "anagram" },
  { id: "chronology", name: "Order of events", how: "Dates and clues only make sense in the right order; sorting them reveals which of several places came last." },
  { id: "object-count", name: "Count the objects", how: "A number made from things counted across scenes (windows, bells, steps, leopards) picks one place from a numbered list." },
  { id: "translation", name: "Translation", how: "A word in another language, translated by a character much earlier, is the place's real name." },
  { id: "map-line", name: "Line on the map", how: "Two earlier places and a direction or distance from the story; following the line lands on the place." },
  { id: "riddle-conditions", name: "All the conditions", how: "A riddle with four conditions; many real places fit three of them; exactly one fits all four." },
];

export const GENRES = ["heist", "spy thriller", "family mystery", "archaeological adventure", "detective whodunnit", "race against time", "lost explorer", "art forgery", "royal secret", "smugglers' trail"];

export const THEMES = [
  "a lost bronze or artwork returning home",
  "a missing scientist's last journey",
  "a ship that vanished with its cargo",
  "an old radio operator's coded broadcasts",
  "a famous footballer's stolen medal",
  "a twin who swapped places",
  "a map drawn on a wedding cloth",
  "a jazz musician's unfinished song",
  "a chess master's last game",
  "a cook's secret recipe book",
  "a forger's confession",
  "a train that never arrived",
  "a lighthouse keeper's diary",
  "a stolen crown jewel",
  "letters from a soldier who never came home",
  "a market woman who outwitted a king",
];
